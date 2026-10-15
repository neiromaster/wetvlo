import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CookieError, DownloadError } from '../../errors/custom-errors.js';

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

/** h5 mtop gateway root. */
const ACS_BASE = 'https://acs.youku.tv/h5';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

/** Replace/add `_m_h5_tk` and `_m_h5_tk_enc` pairs from a raw set-cookie header, in place. */
function applySetCookie(cookiePairs: string[], setCookie: string): void {
  for (const m of setCookie.matchAll(/(_m_h5_tk(?:_enc)?=[^;]+)/g)) {
    const pair = m[1];
    const name = pair?.split('=')[0];
    if (!pair || !name) continue;
    const idx = cookiePairs.findIndex((p) => p.startsWith(`${name}=`));
    if (idx >= 0) cookiePairs[idx] = pair;
    else cookiePairs.push(pair);
  }
}

/** First `_`-segment of the `_m_h5_tk` value in the pairs ('' when absent). */
function tokenFromPairs(cookiePairs: string[]): string {
  const tk = cookiePairs.find((p) => p.startsWith('_m_h5_tk='));
  if (!tk) return '';
  return tk.slice('_m_h5_tk='.length).split('_')[0] ?? '';
}

function parseJsonp(body: string, url: string): unknown {
  const start = body.indexOf('(');
  const end = body.lastIndexOf(')');
  if (start < 0 || end <= start) {
    throw new DownloadError(`Youku: unparseable mtop response: ${body.slice(0, 120)}`, url);
  }
  try {
    return JSON.parse(body.slice(start + 1, end)) as unknown;
  } catch {
    throw new DownloadError(`Youku: unparseable mtop response: ${body.slice(0, 120)}`, url);
  }
}

type MtopEnvelope<T> = {
  ret?: string[];
  data?: { data?: T };
};

/**
 * GET `https://acs.youku.tv/h5/<api>/<version>/` with an mtop-h5 signed query.
 *
 * Mutates `cookiePairs` on the token dance: on `FAIL_SYS_TOKEN_*` the fresh
 * `_m_h5_tk` / `_m_h5_tk_enc` pairs from the response's set-cookie header are
 * patched into the pairs and the request is retried ONCE with a re-computed
 * signature (verified live: the gateway rejects a stale token in the Cookie
 * header even when the URL sign is fresh). Returns the inner `data.data`.
 */
export async function mtopGet<T = unknown>(
  api: string,
  version: string,
  dataObj: object,
  cookiePairs: string[],
): Promise<T> {
  const call = async (): Promise<{ body: string; setCookie: string }> => {
    const t = String(Date.now());
    const dataStr = JSON.stringify(dataObj);
    const url = new URL(`${ACS_BASE}/${api}/${version}/`);
    url.searchParams.set('jsv', '2.6.1');
    url.searchParams.set('appKey', APP_KEY);
    url.searchParams.set('t', t);
    url.searchParams.set('sign', mtopSign(tokenFromPairs(cookiePairs), t, dataStr));
    url.searchParams.set('api', api);
    url.searchParams.set('v', version);
    url.searchParams.set('type', 'jsonp');
    url.searchParams.set('dataType', 'jsonp');
    url.searchParams.set('timeout', '20000');
    url.searchParams.set('callback', 'mtopjsonp1');
    url.searchParams.set('data', dataStr);

    // Defense in depth: youku cookies may only ever be transmitted to youku hosts
    if (!YOUKU_DOMAIN.test(url.host)) {
      throw new CookieError(`Refusing to send youku cookies to non-youku host: ${url.host}`);
    }

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: '*/*',
        Referer: 'https://www.youku.tv/',
        Cookie: cookiePairs.join('; '),
      },
      signal: AbortSignal.timeout(20_000),
    });
    return { body: await res.text(), setCookie: res.headers.get('set-cookie') ?? '' };
  };

  const url = `${ACS_BASE}/${api}/${version}/`;
  let { body, setCookie } = await call();
  if (body.includes('FAIL_SYS_TOKEN')) {
    applySetCookie(cookiePairs, setCookie);
    ({ body } = await call());
  }

  const json = parseJsonp(body, url) as MtopEnvelope<T>;
  const ret = json.ret?.[0] ?? '';
  if (!ret.startsWith('SUCCESS')) {
    throw new DownloadError(`Youku mtop ${api} failed: ${ret}`, url);
  }
  const inner = json.data?.data;
  if (inner === undefined || inner === null) {
    throw new DownloadError(`Youku mtop ${api} returned no data (ret=${ret})`, url);
  }
  return inner;
}
