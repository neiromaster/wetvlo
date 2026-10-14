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
