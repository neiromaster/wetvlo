import { existsSync } from 'node:fs';
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

  const file = Bun.file(cookieFile);
  const content = await file.text();

  // Parse Netscape cookie format and convert to Cookie header format
  const lines = content.split('\n');
  const cookies: string[] = [];

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || !line.trim()) continue;

    const fields = line.split('\t');
    if (fields.length >= 7) {
      const [, _domain, , _path, , , name, value] = fields;
      if (name && value) {
        cookies.push(`${name}=${value}`);
      }
    }
  }

  return cookies.join('; ');
}
