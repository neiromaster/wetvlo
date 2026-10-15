import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CookieError } from '../../errors/custom-errors.js';

/**
 * Site API layer for Youku International (youku.tv).
 *
 * Stream minting goes through the same h5 mtop gateway the web player uses
 * (acs.youku.tv, `mtop.youku.play.ups.appinfo.get`). Verified live 2026-10-15/16:
 * plain HTTP works, `ckey` is not required, the m3u8 needs no cookies (only a
 * youku.tv referer), and subtitle URLs are unsigned CDN links.
 */

/** App key of the Youku international web player (h5 mtop gateway). */
const APP_KEY = '34300712';

/** Netscape cookie domains we may ever transmit to: youku.tv / youku.com and subdomains. */
const YOUKU_DOMAIN = /^\.?(?:[a-z0-9-]+\.)*youku\.(?:tv|com)$/;

export type YoukuStream = {
  stream_type: string;
  width: number;
  height: number;
  /** "default" for plain HLS; anything else is a DRM label and must not be downloaded */
  drm_type?: string;
  /** Real playlist URL; the `auto` entry carries inline playlist text here instead */
  m3u8_url: string;
};

export type YoukuSubtitle = {
  /** `default` (= simplified Chinese), `cht`, `en`, `kr`, `es`, `po`, `th`, `id`, `vi`, `ms` */
  subtitle_lang: string;
  url: string;
};

export type YoukuUpsResult = {
  title: string;
  /** Full episode duration in seconds (video.seconds) */
  seconds: number;
  /** controller.max_stream_level — server quality cap (4 = 720p today) */
  maxStreamLevel: number | null;
  streams: YoukuStream[];
  subtitles: YoukuSubtitle[];
};

/**
 * Parse a Netscape cookies.txt export into `name=value` pairs.
 *
 * Only youku.tv / youku.com cookies survive (defense in depth: the pairs are
 * the only cookie currency this module ever sends). Dedup by name+domain,
 * first wins. `#HttpOnly_` prefixed lines are unescaped before parsing.
 * Throws CookieError when the file is unreadable or holds no youku cookies.
 */
export async function readYoukuCookiePairs(cookieFile: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(cookieFile, 'utf-8');
  } catch {
    throw new CookieError(`Cannot read cookie file: ${cookieFile}`);
  }

  const pairs = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
    const clean = line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line;
    const f = clean.split('\t');
    const domain = f[0];
    const name = f[5];
    const value = f[6];
    if (f.length < 7 || !domain || !name || !value) continue;
    const key = `${name}|${domain.toLowerCase()}`;
    if (!YOUKU_DOMAIN.test(domain.toLowerCase())) continue;
    if (!pairs.has(key)) pairs.set(key, `${name}=${value.trim()}`);
  }

  if (pairs.size === 0) {
    throw new CookieError(
      'No youku.tv/youku.com cookies in the cookie file — re-export cookies from a logged-in browser session',
    );
  }
  return [...pairs.values()];
}

/**
 * mtop-h5 request signature: md5(token & t & appKey & dataStr).
 * `token` is the first `_`-segment of the `_m_h5_tk` cookie value.
 */
export function mtopSign(token: string, t: string, dataStr: string): string {
  return createHash('md5').update(`${token}&${t}&${APP_KEY}&${dataStr}`).digest('hex');
}
