/**
 * Session rescue via a Firefox tab.
 *
 * When a download fails for session reasons (CookieError / TrialContentError),
 * open the series page in the configured Firefox profile: the site refreshes
 * its session cookies on the visit, the browser (when we launched it) is
 * closed gracefully so the cookie DB is flushed to disk, and the domain's
 * cookies are compared before/after to tell whether the visit helped.
 *
 * Scenario detection is free — it rides on the process lifetime:
 * if Firefox is already running with this profile, our process hands the
 * `--new-tab` command over and exits immediately (delegated — the tab lives
 * in the user's own Firefox and cannot be closed from outside); otherwise the
 * spawned process IS the browser and stays alive until we close it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { NotificationLevel } from '../notifications/notification-level.js';
import { findProfileDir, parseCookieBrowserSpec, readFirefoxCookies } from './firefox-cookies';

export type RescueOptions = {
  /** How long to leave the tab open before closing a browser we launched ourselves. */
  waitMs?: number;
  /** Grace period for the graceful (WM_CLOSE) close before falling back to /F. */
  killGraceMs?: number;
  /** Extra wait after a delegated tab before re-reading cookies. */
  delegatedSettleMs?: number;
  /** Test override for the Firefox profile search roots. */
  roots?: string[];
  /** Test override for the firefox.exe path. */
  firefoxPath?: string;
};

export type RescueResult = {
  /** launched = мы запустили и закрыли Firefox; delegated = вкладка ушла в живой Firefox; skipped = делать нечего. */
  outcome: 'launched' | 'delegated' | 'skipped';
  /** Куки домена (пары name=value) различаются до/после визита. */
  cookiesChanged: boolean;
  /** Заполнено при outcome === 'skipped'. */
  skipReason?: string;
};

const DEFAULT_WAIT_MS = 20_000;
const DEFAULT_KILL_GRACE_MS = 10_000;
const DEFAULT_DELEGATED_SETTLE_MS = 5_000;

/** Standard Windows install locations, in probe order. Covers the per-user
 * install (%LOCALAPPDATA%, the modern installer default) and machine-wide ones. */
export function defaultFirefoxPaths(): string[] {
  const paths: string[] = [];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) paths.push(join(localAppData, 'Mozilla Firefox', 'firefox.exe'));
  const programFiles = process.env.ProgramFiles;
  if (programFiles) paths.push(join(programFiles, 'Mozilla Firefox', 'firefox.exe'));
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  if (programFilesX86) paths.push(join(programFilesX86, 'Mozilla Firefox', 'firefox.exe'));
  return paths;
}

function findFirefoxExecutable(override?: string): string | undefined {
  if (override) return existsSync(override) ? override : undefined;
  return defaultFirefoxPaths().find((p) => existsSync(p));
}

/** Sorted "name=value" pairs of the domain's cookies, for before/after comparison. */
async function cookieSnapshot(spec: string, url: string, roots?: string[]): Promise<string[]> {
  try {
    const cookies = await readFirefoxCookies(spec, { url, roots });
    return cookies.map((c) => `${c.name}=${c.value}`).sort();
  } catch {
    return []; // unreadable snapshot = empty; the after-snapshot decides
  }
}

function snapshotEquals(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type ExecaChild = ReturnType<typeof execa>;

export async function refreshSessionsViaTab(spec: string, url: string, opts?: RescueOptions): Promise<RescueResult> {
  const firefoxPath = findFirefoxExecutable(opts?.firefoxPath);
  if (!firefoxPath) {
    return { outcome: 'skipped', cookiesChanged: false, skipReason: 'firefox.exe not found' };
  }
  let profile: string;
  try {
    profile = parseCookieBrowserSpec(spec).profile;
  } catch (error) {
    return { outcome: 'skipped', cookiesChanged: false, skipReason: (error as Error).message };
  }
  try {
    findProfileDir(profile, opts?.roots);
  } catch (error) {
    return { outcome: 'skipped', cookiesChanged: false, skipReason: (error as Error).message };
  }

  const before = await cookieSnapshot(spec, url, opts?.roots);

  const child = execa(firefoxPath, ['-P', profile, '--new-tab', url], { stdio: 'ignore', reject: false });
  const exitedEarly = await Promise.race([
    child.then(
      () => true,
      () => true,
    ),
    sleep(opts?.waitMs ?? DEFAULT_WAIT_MS).then(() => false),
  ]);

  let outcome: RescueResult['outcome'];
  if (exitedEarly) {
    // The tab went to an already-running Firefox — we can't close it from outside
    outcome = 'delegated';
    await sleep(opts?.delegatedSettleMs ?? DEFAULT_DELEGATED_SETTLE_MS);
  } else {
    // Process alive — this is a browser we launched; close it
    outcome = 'launched';
    await closeGracefully(child, opts?.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
  }

  const after = await cookieSnapshot(spec, url, opts?.roots);
  return { outcome, cookiesChanged: !snapshotEquals(before, after) };
}

/** Close a browser we launched: WM_CLOSE first (clean shutdown flushes cookies to disk), then /F. */
async function closeGracefully(child: ExecaChild, graceMs: number): Promise<void> {
  if (child.pid === undefined) return;
  // Fire the WM_CLOSE signal and move on: real `taskkill /PID` posts the close
  // and returns immediately — the browser's exit is what the race below awaits.
  void execa('taskkill', ['/PID', String(child.pid)], { reject: false }).catch(() => {});
  const exited = await Promise.race([
    child.then(
      () => true,
      () => true,
    ),
    sleep(graceMs).then(() => false),
  ]);
  if (!exited) {
    await execa('taskkill', ['/PID', String(child.pid), '/F'], { reject: false });
  }
  // Bound the reap: if /F failed (e.g. access denied), never hang the caller
  await Promise.race([child.catch(() => {}), sleep(REAP_TIMEOUT_MS)]);
}

export type RescueAttempt = {
  attempted: boolean;
  cookiesChanged?: boolean;
};

export type RescueNotifier = (level: NotificationLevel, message: string) => void;

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

/** Defensive cap for the post-/F reap in closeGracefully. */
const REAP_TIMEOUT_MS = 5_000;

/**
 * Per-domain wrapper around refreshSessionsViaTab with a cooldown and user
 * notifications. The cooldown keeps a truly dead session from spamming
 * Firefox tabs on every retry: at most one rescue per domain per cooldown.
 */
export class CookieSessionRescue {
  private readonly lastAttemptAt = new Map<string, number>();

  constructor(
    private readonly cooldownMs: number = DEFAULT_COOLDOWN_MS,
    private readonly refresh: typeof refreshSessionsViaTab = refreshSessionsViaTab,
  ) {}

  async maybeRescue(
    domain: string,
    spec: string,
    url: string,
    seriesName: string,
    notify: RescueNotifier,
  ): Promise<RescueAttempt> {
    const now = Date.now();
    const last = this.lastAttemptAt.get(domain);
    if (last !== undefined && now - last < this.cooldownMs) {
      return { attempted: false };
    }
    this.lastAttemptAt.set(domain, now); // marked BEFORE the run

    let profile = '?';
    try {
      profile = parseCookieBrowserSpec(spec).profile;
    } catch {
      // the spec is already schema-validated; never let the rescue crash here
    }

    notify(
      NotificationLevel.INFO,
      `[${domain}] ${seriesName}: session/trial error — opening the series page in Firefox (profile ${profile}) to refresh the session`,
    );

    const result = await this.refresh(spec, url);

    if (result.outcome === 'skipped') {
      notify(
        NotificationLevel.WARNING,
        `[${domain}] ${seriesName}: session rescue skipped: ${result.skipReason ?? 'unknown reason'}`,
      );
      return { attempted: true, cookiesChanged: false };
    }

    const where = result.outcome === 'launched' ? 'browser opened and closed' : 'tab opened in the running Firefox';
    if (result.cookiesChanged) {
      notify(NotificationLevel.INFO, `[${domain}] ${seriesName}: ${where}, domain cookies updated — retrying now`);
    } else if (result.outcome === 'delegated') {
      notify(
        NotificationLevel.WARNING,
        `[${domain}] ${seriesName}: tab opened in the running Firefox (close it yourself); cookies unchanged — if the error repeats, log back in to Firefox`,
      );
    } else {
      notify(
        NotificationLevel.WARNING,
        `[${domain}] ${seriesName}: ${where}, cookies unchanged — if the error repeats, log back in to Firefox`,
      );
    }
    return { attempted: true, cookiesChanged: result.cookiesChanged };
  }
}
