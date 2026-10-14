import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CookieError } from '../errors/custom-errors';

/**
 * Get browser cookie database path
 */
function getBrowserPath(browser: string): string {
  const home = homedir();
  const platform = process.platform;

  const paths: Record<string, Record<string, string>> = {
    darwin: {
      chrome: join(home, 'Library/Application Support/Google/Chrome/Default/Cookies'),
      chromium: join(home, 'Library/Application Support/Chromium/Default/Cookies'),
      edge: join(home, 'Library/Application Support/Microsoft Edge/Default/Cookies'),
      firefox: join(home, 'Library/Application Support/Firefox/Profiles'),
      safari: join(home, 'Library/Cookies/Cookies.binarycookies'),
    },
    linux: {
      chrome: join(home, '.config/google-chrome/Default/Cookies'),
      chromium: join(home, '.config/chromium/Default/Cookies'),
      edge: join(home, '.config/microsoft-edge/Default/Cookies'),
      firefox: join(home, '.mozilla/firefox'),
      safari: '', // Safari not on Linux
    },
    win32: {
      chrome: join(home, 'AppData/Local/Google/Chrome/User Data/Default/Cookies'),
      chromium: join(home, 'AppData/Local/Chromium/User Data/Default/Cookies'),
      edge: join(home, 'AppData/Local/Microsoft/Edge/User Data/Default/Cookies'),
      firefox: join(home, 'AppData/Roaming/Mozilla/Firefox/Profiles'),
      safari: '', // Safari not on Windows
    },
  };

  const browserPaths = paths[platform];
  if (!browserPaths) {
    throw new CookieError(`Unsupported platform: ${platform}`);
  }

  const path = browserPaths[browser];
  if (!path) {
    throw new CookieError(`Browser "${browser}" not supported on ${platform}`);
  }

  return path;
}

/**
 * Extract cookies from browser for a specific domain
 * This is a simplified version - in production, you'd use a proper SQLite parser
 * or a library like `tough-cookie-file-store`
 *
 * @param domain - Domain to extract cookies for (e.g., "wetv.vip")
 * @param browser - Browser to extract from
 * @returns Cookie string in Netscape format
 */
export async function extractCookies(domain: string, browser: string = 'chrome'): Promise<string> {
  const cookiePath = getBrowserPath(browser);

  if (!existsSync(cookiePath)) {
    throw new CookieError(
      `Cookie database not found at "${cookiePath}". ` +
        `Make sure ${browser} is installed and you've logged in to the site.`,
    );
  }

  // For now, we'll use a simpler approach: tell the user to export cookies manually
  // In production, you'd use a proper SQLite parser here
  throw new CookieError(
    `Automatic cookie extraction is not yet implemented for ${browser}. ` +
      `Please export cookies manually:\n` +
      `1. Install a browser extension like "Get cookies.txt LOCALLY"\n` +
      `2. Go to ${domain} and log in\n` +
      `3. Export cookies to a file\n` +
      `4. Set 'cookieFile' in config.yaml to the exported file path`,
  );
}

/**
 * Read cookies from a Netscape-format cookie file
 *
 * @param cookieFile - Path to cookie file
 * @returns Cookie string for HTTP requests
 */
export async function readCookieFile(cookieFile: string): Promise<string> {
  if (!existsSync(cookieFile)) {
    throw new CookieError(`Cookie file not found: "${cookieFile}"`);
  }

  const content = await readFile(cookieFile, 'utf-8');

  // Parse Netscape cookie format and convert to Cookie header format
  const lines = content.split('\n');
  const cookies: string[] = [];

  for (const line of lines) {
    // Skip comments and empty lines
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('#') || !trimmedLine) continue;

    const fields = line.split('\t');
    if (fields.length >= 7) {
      const name = fields[5];
      const value = fields[6];

      if (name && value) {
        const cleanValue = value.trim();
        if (cleanValue) {
          cookies.push(`${name}=${cleanValue}`);
        }
      }
    }
  }

  return cookies.join('; ');
}

/**
 * Read a Netscape-format cookie file and build a `Cookie` header containing
 * ONLY cookies whose domain matches the given URL's host. Cookie files may
 * contain credentials for unrelated sites — nothing outside the target
 * domain may ever be sent. Deduplicates by name+domain (first wins).
 *
 * @param cookieFile - Path to the Netscape-format cookie file
 * @param url - Target URL whose host determines the domain filter
 * @returns Cookie header value; empty string when no cookies match
 * @throws CookieError when the file is unreadable
 */
export async function readCookieHeaderForUrl(cookieFile: string, url: string): Promise<string> {
  let content: string;
  try {
    content = await readFile(cookieFile, 'utf-8');
  } catch (error) {
    throw new CookieError(
      `Cannot read cookie file "${cookieFile}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new CookieError(`Invalid URL for cookie domain filter: "${url}"`);
  }

  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // "#HttpOnly_" prefix is curl's convention for HTTP-only cookies — not a comment
    const effective = trimmed.startsWith('#HttpOnly_') ? trimmed.slice(10) : trimmed;
    if (!effective || effective.startsWith('#')) continue;
    const fields = effective.split('\t');
    const domain = (fields[0] ?? '').toLowerCase();
    if (fields.length < 7 || !fields[5] || !fields[6]) continue;
    const matches =
      host === domain ||
      host.endsWith(`.${domain}`) ||
      (domain.startsWith('.') && (host === domain.slice(1) || host.endsWith(domain)));
    if (!matches) continue;
    const key = `${fields[5]}|${fields[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(`${fields[5]}=${fields[6].trim()}`);
  }

  return pairs.join('; ');
}
