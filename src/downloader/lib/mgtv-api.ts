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

/**
 * Step 1: player info — returns the pm2 signature needed by getSource
 * plus account status (login/isvip) for logging.
 */
export async function fetchPlayerInfo(videoId: string, cookies?: string): Promise<MgtvPlayerInfo> {
  const did = crypto.randomUUID();
  const suuid = crypto.randomUUID();
  const url =
    `https://tinker2.glb.mgtv.com/player/video?_support=10000000&did=${did}&suuid=${suuid}&cxid=` +
    `&tk2=${makeTk2(did)}&video_id=${videoId}&abroad=10&src=intelmgtv&ch=default&-ch=default`;
  const data = await mgtvFetchJson(url, cookies);
  const user = data?.data?.user;
  return {
    pm2: String(data?.data?.atc?.pm2 ?? ''),
    login: user?.login === true,
    isvip: user?.isvip === '1',
    title: data?.data?.info?.title !== undefined ? String(data.data.info.title) : undefined,
    duration: data?.data?.info?.duration !== undefined ? Number(data.data.info.duration) : undefined,
  };
}

/**
 * Step 2: stream list — available qualities for the episode.
 * Locked (VIP, unauthenticated) streams come back with an empty url.
 */
export async function fetchSourceStreams(videoId: string, pm2: string, cookies?: string): Promise<MgtvSource> {
  const did = crypto.randomUUID();
  const suuid = crypto.randomUUID();
  const url =
    `https://tinker.glb.mgtv.com/player/getSource?_support=10000000&tk2=${makeTk2(did)}&pm2=${pm2}` +
    `&video_id=${videoId}&did=${did}&suuid=${suuid}&abroad=10&src=intelmgtv&ch=default&-ch=default` +
    `&auth_mode=1&type=pad`;
  const data = await mgtvFetchJson(url, cookies);
  const streams: any[] = Array.isArray(data?.data?.stream) ? data.data.stream : [];
  return {
    streamDomain: String(data?.data?.stream_domain?.[0] ?? ''),
    streams: streams.map((s) => ({
      name: String(s.name ?? ''),
      filebitrate: String(s.filebitrate ?? '0'),
      vip: String(s.vip ?? '0'),
      url: String(s.url ?? ''),
    })),
  };
}

/**
 * Step 3: resolve the short-lived signed m3u8 URL. Must be called right
 * before handing the URL to yt-dlp — tokens expire quickly.
 * `&arange=` must be stripped from the stream url or the API errors.
 */
export async function resolveM3u8Url(streamDomain: string, streamUrl: string): Promise<string> {
  const url = `${streamDomain}${streamUrl.replace(/&arange=\d+/g, '')}`;
  const data = await mgtvFetchJson(url);
  if (!data?.info || typeof data.info !== 'string') {
    throw new DownloadError('MGTV did not return a signed m3u8 URL (stream offer may have expired)', url);
  }
  return data.info;
}

/**
 * Subtitles step 1: available subtitle languages for the episode.
 */
export async function fetchSubtitleList(videoId: string, cookies?: string): Promise<MgtvSubtitleEntry[]> {
  const url = `https://tinker.glb.mgtv.com/video/title?videoId=${videoId}&_support=10000000&abroad=10&src=intelmgtv`;
  const data = await mgtvFetchJson(url, cookies);
  const list: any[] = Array.isArray(data?.data?.title) ? data.data.title : [];
  return list
    .map((t) => ({
      name: String(t.name ?? ''),
      code: String(t.captionSimpleName ?? ''),
      url: String(t.url ?? ''),
    }))
    .filter((t) => t.url.length > 0);
}

/**
 * Subtitles step 2: exchange the entry's /vod.do path for the signed .srt URL.
 */
export async function resolveSubtitleUrl(entry: MgtvSubtitleEntry): Promise<string> {
  const url = `https://disp-glb.titan.mgtv.com${entry.url}`;
  const data = await mgtvFetchJson(url);
  if (!data?.info || typeof data.info !== 'string') {
    throw new DownloadError(`MGTV did not return a signed subtitle URL for "${entry.name}"`, url);
  }
  return data.info;
}

/**
 * Subtitles step 3: download the .srt text. hitv.com gets NO cookies —
 * it is a CDN domain and the URL is already signed.
 */
export async function downloadSubtitle(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': MGTV_UA, Referer: 'https://w.mgtv.com/' } });
  if (!res.ok) {
    throw new DownloadError(`Failed to download subtitle (HTTP ${res.status})`, url);
  }
  return res.text();
}

/** Injectable API surface — lets tests stub the network out of MgtvDownloader. */
export type MgtvApi = {
  fetchPlayerInfo: (videoId: string, cookies?: string) => Promise<MgtvPlayerInfo>;
  fetchSourceStreams: (videoId: string, pm2: string, cookies?: string) => Promise<MgtvSource>;
  resolveM3u8Url: (streamDomain: string, streamUrl: string) => Promise<string>;
  fetchSubtitleList: (videoId: string, cookies?: string) => Promise<MgtvSubtitleEntry[]>;
  resolveSubtitleUrl: (entry: MgtvSubtitleEntry) => Promise<string>;
  downloadSubtitle: (url: string) => Promise<string>;
};

export const mgtvApi: MgtvApi = {
  fetchPlayerInfo,
  fetchSourceStreams,
  resolveM3u8Url,
  fetchSubtitleList,
  resolveSubtitleUrl,
  downloadSubtitle,
};
