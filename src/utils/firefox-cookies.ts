import { type Dirent, existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

const DB_FILES = ['cookies.sqlite', 'cookies.sqlite-wal', 'cookies.sqlite-shm'] as const;
/** FF142+ upgraded the cookies DB to schema 16 and switched expiry to milliseconds. */
const MS_EXPIRY_SCHEMA_VERSION = 16;

/**
 * True when the cookie's domain should be sent to the URL's host. Same
 * matching as the old cookie-extractor: exact host, subdomain of it, or a
 * dot-domain (".iq.com" covers www.iq.com and iq.com).
 */
export function domainMatchesUrl(domain: string, url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const d = domain.toLowerCase().replace(/^\./, '');
  return host === d || host.endsWith(`.${d}`);
}

/**
 * Read cookies from a Firefox profile. Firefox keeps the database locked, so
 * cookies.sqlite (+ optional wal/shm) is copied to a temp dir and read from
 * the copy — safe while Firefox is running. No caching: every call takes a
 * fresh snapshot. Cookies are filtered by URL host (when `url` is given),
 * expired ones are dropped (schema >= 16 stores milliseconds), duplicates
 * collapse by name|domain (first wins).
 */
export async function readFirefoxCookies(
  spec: string,
  opts: { url?: string; roots?: string[] } = {},
): Promise<FirefoxCookie[]> {
  const { profile } = parseCookieBrowserSpec(spec);
  const profileDir = findProfileDir(profile, opts.roots);

  const tmp = await mkdtemp(join(tmpdir(), 'wetvlo-cookies-'));
  try {
    for (const name of DB_FILES) {
      const src = join(profileDir, name);
      if (!existsSync(src)) {
        if (name === 'cookies.sqlite') {
          throw new CookieError(`Firefox profile "${profile}": cookies.sqlite not found in ${profileDir}`);
        }
        continue; // wal/shm are optional
      }
      try {
        await copyFile(src, join(tmp, name));
      } catch (error) {
        if (name !== 'cookies.sqlite' && (error as { code?: string }).code === 'ENOENT') {
          continue; // wal/shm vanished between existsSync and copyFile — still fine
        }
        throw error;
      }
    }

    // Open and read inside one guard: a torn copy (Firefox checkpointing
    // between the main db and wal copies) surfaces as a raw SQLiteError at
    // open OR query time — wrap it in the module's CookieError contract.
    try {
      const db = new DatabaseSync(join(tmp, 'cookies.sqlite'), { readOnly: true });
      try {
        const { user_version: schemaVersion } = db.prepare('PRAGMA user_version').get() as { user_version: number };
        const msExpiry = schemaVersion >= MS_EXPIRY_SCHEMA_VERSION;
        const rows = db.prepare('SELECT name, value, host, path, expiry, isSecure FROM moz_cookies').all() as Array<{
          name: string;
          value: string;
          host: string;
          path: string;
          expiry: number | null;
          isSecure: number;
        }>;

        const nowSeconds = Math.floor(Date.now() / 1000);
        const cookies: FirefoxCookie[] = [];
        const seen = new Set<string>();
        for (const row of rows) {
          if (!row.name || !row.value) continue;
          let expiry = row.expiry ?? 0;
          if (msExpiry && expiry > 0) expiry = Math.floor(expiry / 1000);
          if (expiry > 0 && expiry <= nowSeconds) continue; // expired
          if (opts.url && !domainMatchesUrl(row.host, opts.url)) continue;
          const key = `${row.name}|${row.host}`;
          if (seen.has(key)) continue;
          seen.add(key);
          cookies.push({
            name: row.name,
            value: row.value,
            domain: row.host,
            path: row.path || '/',
            secure: row.isSecure === 1,
            expiry,
          });
        }
        return cookies;
      } finally {
        db.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CookieError(`Firefox profile "${profile}": cannot read cookies.sqlite in ${profileDir}: ${message}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Build a `Cookie` header from the Firefox profile containing ONLY cookies
 * scoped to the URL's host. Empty string when nothing matches — callers
 * decide whether that is fatal.
 */
export async function readCookieHeaderForUrl(
  spec: string,
  url: string,
  opts: { roots?: string[] } = {},
): Promise<string> {
  const cookies = await readFirefoxCookies(spec, { url, roots: opts.roots });
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
