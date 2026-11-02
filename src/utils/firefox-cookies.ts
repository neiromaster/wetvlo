import { type Dirent, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppContext } from '../app-context';
import { CookieError } from '../errors/custom-errors';
import { NotificationLevel } from '../notifications/notification-level.js';

export type CookieBrowserSpec = {
  browser: 'firefox';
  profile: string;
};

export type FirefoxCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  /** Unix seconds; 0 = session cookie */
  expiry: number;
};

const COOKIE_SPEC_PREFIX = 'firefox:';

/**
 * Parse a yt-dlp-style cookies-from-browser spec. Only Firefox is supported:
 * its cookie database is plaintext SQLite (no DPAPI/Keychain involved).
 */
export function parseCookieBrowserSpec(spec: string): CookieBrowserSpec {
  if (!spec.startsWith(COOKIE_SPEC_PREFIX)) {
    throw new CookieError(`cookiesFromBrowser "${spec}": only "${COOKIE_SPEC_PREFIX}<profile>" is supported`);
  }
  const profile = spec.slice(COOKIE_SPEC_PREFIX.length).trim();
  if (!profile) {
    throw new CookieError(`cookiesFromBrowser "${spec}": expected format "${COOKIE_SPEC_PREFIX}<profile>"`);
  }
  return { browser: 'firefox', profile };
}

/**
 * Firefox profile search roots (same set yt-dlp uses on Windows):
 * the normal install and the MS Store packaged install.
 */
export function defaultProfileRoots(): string[] {
  const roots: string[] = [];
  const appData = process.env.APPDATA;
  if (appData) roots.push(join(appData, 'Mozilla', 'Firefox', 'Profiles'));
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    roots.push(
      join(
        localAppData,
        'Packages',
        'Mozilla.Firefox_n80bbvh6b1yt2',
        'LocalCache',
        'Roaming',
        'Mozilla',
        'Firefox',
        'Profiles',
      ),
    );
  }
  return roots;
}

/**
 * Locate the profile directory. Directory names are "<hash>.<name>"; the
 * spec matches the full name or the suffix after the dot. Several matches
 * resolve to the lexically first one (a warning is logged when a notifier
 * is available). Roots that cannot be read are skipped.
 */
export function findProfileDir(profile: string, roots: string[] = defaultProfileRoots()): string {
  const matches: string[] = [];
  for (const root of roots) {
    let entries: Dirent[];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue; // root missing (e.g. no MS Store Firefox)
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue; // a file named like a profile is not a profile
      const name = entry.name;
      if (name === profile || name.endsWith(`.${profile}`)) {
        matches.push(join(root, name));
      }
    }
  }
  matches.sort();
  const first = matches[0];
  if (first === undefined) {
    const searched = roots.length ? roots.join(', ') : '(no profile roots found)';
    throw new CookieError(`Firefox profile "${profile}" not found in: ${searched}`);
  }
  if (matches.length > 1) {
    try {
      AppContext.getNotifier().notify(
        NotificationLevel.WARNING,
        `Multiple Firefox profiles match "${profile}" — using ${first}`,
      );
    } catch {
      // AppContext not initialized (unit tests) — the first match is still fine
    }
  }
  return first;
}
