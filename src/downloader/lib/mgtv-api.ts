import { readFile } from 'node:fs/promises';

import { CookieError, DownloadError } from '../../errors/custom-errors.js';

/**
 * MGTV International API layer (tinker*.glb.mgtv.com).
 *
 * Everything site-specific about MGTV lives here: auth signature, cookie
 * handling, JSONP unwrap, and the endpoints for streams and subtitles.
 * Verified live 2026-10-14 against https://w.mgtv.com/b/908834/24677071.html.
 */

export const MGTV_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** One quality variant from getSource. `filebitrate` is a numeric string; locked streams have an empty `url`. */
export type MgtvStream = {
  name: string;
  filebitrate: string;
  vip: string;
  url: string;
};

/** Result of getSource: stream host + available quality variants. */
export type MgtvSource = {
  streamDomain: string;
  streams: MgtvStream[];
};

/** Result of player/video: pm2 signature for getSource + account status. */
export type MgtvPlayerInfo = {
  pm2: string;
  login: boolean;
  isvip: boolean;
  title?: string;
  duration?: number;
};

/** One subtitle language from video/title. `code` is e.g. "RU", "EN", "ZH_CN". */
export type MgtvSubtitleEntry = {
  name: string;
  code: string;
  url: string;
};

/**
 * Build the `tk2` auth parameter used by all tinker endpoints.
 * base64("did={did}|pno=1030|ver=0.3.0301|clit={clit}") with URL-safe-ish
 * substitutions (+→_, /→~, =→-), then reversed.
 *
 * @param did - Random device UUID (generated per run)
 * @param clit - Unix timestamp in seconds; defaults to now
 */
export function makeTk2(did: string, clit: number = Math.floor(Date.now() / 1000)): string {
  const raw = `did=${did}|pno=1030|ver=0.3.0301|clit=${clit}`;
  const b64 = Buffer.from(raw).toString('base64').replace(/\+/g, '_').replace(/\//g, '~').replace(/=/g, '-');
  return b64.split('').reverse().join('');
}

/**
 * Extract the numeric MGTV video id from an episode page URL,
 * e.g. https://w.mgtv.com/b/908834/24677071.html → "24677071".
 * Returns null when the URL has no episode path.
 */
export function extractVideoId(url: string): string | null {
  const match = url.match(/\/b\/\d+\/(\d+)\.html/);
  return match?.[1] ?? null;
}

/**
 * Read a Netscape-format cookies.txt and build a `Cookie` header containing
 * ONLY mgtv.com cookies. Users export their whole browser (500+ lines with
 * unrelated accounts) — nothing outside *.mgtv.com may ever be sent.
 * Deduplicates by name+domain (first occurrence wins).
 *
 * @param cookieFile - Path to the Netscape-format cookie file
 * @returns Cookie header value, e.g. "PHPSESSID=abc; sessionid=xyz"
 * @throws CookieError when the file is unreadable or has no mgtv.com cookies
 */
export async function readMgtvCookieHeader(cookieFile: string): Promise<string> {
  let content: string;
  try {
    content = await readFile(cookieFile, 'utf-8');
  } catch (error) {
    throw new CookieError(
      `Cannot read MGTV cookie file "${cookieFile}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // "#HttpOnly_" prefix is curl's convention for HTTP-only cookies — not a comment
    const effective = trimmed.startsWith('#HttpOnly_') ? trimmed.slice(10) : trimmed;
    if (!effective || effective.startsWith('#')) continue;
    const fields = effective.split('\t');
    const domain = fields[0] ?? '';
    if (fields.length < 7 || (domain !== 'mgtv.com' && !domain.endsWith('.mgtv.com')) || !fields[5] || !fields[6])
      continue;
    const key = `${fields[5]}|${fields[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(`${fields[5]}=${fields[6].trim()}`);
  }

  if (pairs.length === 0) {
    throw new CookieError(`No mgtv.com cookies found in "${cookieFile}" — re-export cookies from a logged-in browser`);
  }
  return pairs.join('; ');
}

/**
 * Unwrap a MGTV API response body: plain JSON or JSONP (`jsonp_<ts>_<n>({...})`).
 */
function parseJsonp(text: string): unknown {
  const s = text.trim();
  if (s.startsWith('{') || s.startsWith('[')) return JSON.parse(s);
  const start = s.indexOf('(');
  const end = s.lastIndexOf(')');
  return JSON.parse(s.slice(start + 1, end));
}

/**
 * Fetch a MGTV API endpoint and return the parsed payload.
 *
 * - Sends browser-like headers on every request.
 * - Attaches the `Cookie` header ONLY when the target host is mgtv.com —
 *   the cookie file may contain cookies for unrelated sites and those
 *   must never leave the machine.
 * - Throws `DownloadError` for every failure mode: malformed URL / network
 *   error / non-2xx HTTP status, and a payload carrying a non-200 `code`.
 *   (The subtitle `vod.do` endpoint has no `code` field at all — only
 *   `status: "ok"` — so a missing code is not an error.)
 *
 * @param url - Absolute endpoint URL
 * @param cookies - Optional Cookie header value (from readMgtvCookieHeader)
 */
export async function mgtvFetchJson(url: string, cookies?: string): Promise<any> {
  const headers: Record<string, string> = {
    'User-Agent': MGTV_UA,
    Referer: 'https://w.mgtv.com/',
    Accept: '*/*',
  };
  let res: Response;
  let text: string;
  try {
    const host = new URL(url).hostname;
    if (cookies && (host === 'mgtv.com' || host.endsWith('.mgtv.com'))) {
      headers.Cookie = cookies;
    }
    res = await fetch(url, { headers });
    text = await res.text();
  } catch (error) {
    throw new DownloadError(`MGTV request failed: ${error instanceof Error ? error.message : String(error)}`, url);
  }

  if (!res.ok) {
    throw new DownloadError(`MGTV API HTTP ${res.status}: ${text.slice(0, 200)}`, url);
  }

  let parsed: any;
  try {
    parsed = parseJsonp(text);
  } catch {
    throw new DownloadError(
      `MGTV API returned an unparseable response (HTTP ${res.status}): ${text.slice(0, 200)}`,
      url,
    );
  }

  if (parsed && typeof parsed === 'object' && 'code' in parsed && Number(parsed.code) !== 200) {
    throw new DownloadError(`MGTV API error (code ${parsed.code}): ${parsed.msg ?? 'unknown error'}`, url);
  }
  return parsed;
}
