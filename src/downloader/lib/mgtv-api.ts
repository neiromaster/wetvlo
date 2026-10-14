import { readFile } from 'node:fs/promises';

import { CookieError } from '../../errors/custom-errors.js';

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
    if (!trimmed || trimmed.startsWith('#')) continue;
    const fields = trimmed.split('\t');
    if (fields.length < 7 || !fields[0]?.includes('mgtv.com') || !fields[5] || !fields[6]) continue;
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
