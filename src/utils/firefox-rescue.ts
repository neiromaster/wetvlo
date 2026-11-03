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

export const DEFAULT_WAIT_MS = 20_000;
const DEFAULT_KILL_GRACE_MS = 10_000;
const DEFAULT_DELEGATED_SETTLE_MS = 5_000;

/** Standard Windows install locations, in probe order. */
export function defaultFirefoxPaths(): string[] {
  const paths: string[] = [];
  const programFiles = process.env['ProgramFiles'];
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
  await child.catch(() => {}); // reap, never throws
}
