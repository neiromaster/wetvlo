import { createHash, randomUUID } from 'node:crypto';
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

/**
 * Send-time precedence when the same cookie name exists on several youku
 * domains. Cookie files legitimately hold one name per subdomain (browsers
 * only send the domain-matched ones), but this module joins ALL pairs into a
 * single Cookie header — and youku answers HTTP 400 to headers with duplicate
 * names (observed 2026-10-16: 61 pairs / 43 unique names → 400; dedup → 200).
 * Auth cookies (P_sck, P_gck, cna, _m_h5_tk) live on `.youku.tv`, so it wins.
 */
function youkuDomainRank(domain: string): number {
  switch (domain.toLowerCase()) {
    case '.youku.tv':
      return 0;
    case 'youku.tv':
      return 1;
    case 'www.youku.tv':
      return 2;
    case '.youku.com':
      return 3;
    case 'youku.com':
      return 4;
    case 'www.youku.com':
      return 5;
    default:
      return 6; // other youku subdomains (passport, pay, so, ad, ...)
  }
}

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
  /**
   * True when the server answered with a 6-minute trial (locked/TVOD episode).
   * Only ever `true` for callers passing `{ allowTrial: true }`; such payloads
   * still carry the full subtitle array (verified 2026-10-16), while their
   * stream entries are trial previews and must not be downloaded.
   */
  trial?: boolean;
};

/**
 * Parse a Netscape cookies.txt export into `name=value` pairs.
 *
 * Only youku.tv / youku.com cookies survive (defense in depth: the pairs are
 * the only cookie currency this module ever sends). `.www.*` re-domained junk
 * is dropped (same class as isJunkCookieDomain in utils/cookie-sync — keep in
 * sync). Dedup is by NAME across domains with youkuDomainRank precedence —
 * duplicate names in one Cookie header make youku answer HTTP 400.
 * `#HttpOnly_` prefixed lines are unescaped before parsing.
 * Throws CookieError when the file is unreadable or holds no youku cookies.
 */
export async function readYoukuCookiePairs(cookieFile: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(cookieFile, 'utf-8');
  } catch {
    throw new CookieError(`Cannot read cookie file: ${cookieFile}`);
  }

  const pairs = new Map<string, { rank: number; pair: string }>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
    const clean = line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line;
    const f = clean.split('\t');
    const domain = f[0];
    const name = f[5];
    const value = f[6];
    if (f.length < 7 || !domain || !name || !value) continue;
    const domainKey = domain.toLowerCase();
    if (!YOUKU_DOMAIN.test(domainKey)) continue;
    if (domainKey.startsWith('.www.')) continue; // re-domained junk — never send
    const candidate = { rank: youkuDomainRank(domainKey), pair: `${name}=${value.trim()}` };
    const existing = pairs.get(name);
    if (!existing || candidate.rank < existing.rank) pairs.set(name, candidate);
  }

  if (pairs.size === 0) {
    throw new CookieError(
      'No youku.tv/youku.com cookies in the cookie file — re-export cookies from a logged-in browser session',
    );
  }
  return [...pairs.values()].map((entry) => entry.pair);
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

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: '*/*',
          Referer: 'https://www.youku.tv/',
          Cookie: cookiePairs.join('; '),
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new DownloadError(
        `Youku request failed: ${error instanceof Error ? error.message : String(error)}`,
        url.toString(),
      );
    }
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

const UPS_API = 'mtop.youku.play.ups.appinfo.get';
const UPS_VERSION = '1.1';

/** Captured template values (2026-10-15). `current_showid` is server-ignored (verified: blank/wrong/absent all mint). */
const BIZ_PARAMS_BASE = {
  current_showid: '816853',
  preferClarity: -1,
  media_type: 'standard,subtitle',
  app_ver: '9.8.10',
  extag: 'EXT-X-PRIVINF',
  play_ability: 16782592,
  close_ability: 655360,
  master_m3u8: 1,
  skh: 1,
  last_clarity: -1,
  wdm: 1,
  enc_ver: 2,
};

/** Shape of the ups inner payload this module consumes (rest is ignored). */
type UpsInner = {
  error?: { code?: number; note?: string };
  trial?: unknown;
  video?: { title?: string; seconds?: number };
  controller?: { max_stream_level?: number };
  stream?: YoukuStream[];
  subtitle?: YoukuSubtitle[];
};

/**
 * Mint stream + subtitle URLs for one episode via the ups API.
 *
 * `utid` MUST be a device id the server already associates with these cookies:
 * the `cna` cookie value works; a fresh random id trips risk control
 * (`error.code === -6004`, "suspicious behavior", no streams). When `cna` is
 * absent we still try a generated id — the -6004 branch below turns the
 * inevitable rejection into an actionable error.
 *
 * By default a trial response (locked/TVOD episode, anonymous or expired
 * cookies) throws. With `{ allowTrial: true }` the payload is returned with
 * `trial: true` instead — used by the subtitles-before-video flow: trial
 * payloads carry the full subtitle array but only preview streams.
 *
 * Throws DownloadError on: risk control -6004, trial response (unless
 * allowTrial), or transport failures.
 */
export async function mintUps(
  vid: string,
  cookiePairs: string[],
  options?: { allowTrial?: boolean },
): Promise<YoukuUpsResult> {
  const cna = cookiePairs.find((p) => p.startsWith('cna='))?.slice('cna='.length) ?? '';
  const dataObj = {
    steal_params: JSON.stringify({
      ccode: '0597',
      utid: cna || randomUUID(),
      version: '9.8.10',
      client_ip: '127.0.0.1',
      client_ts: Math.floor(Date.now() / 1000),
    }),
    biz_params: JSON.stringify({ ...BIZ_PARAMS_BASE, vid, local_vid: vid }),
    ad_params: '{}',
  };

  const inner = await mtopGet<UpsInner>(UPS_API, UPS_VERSION, dataObj, cookiePairs);

  if (inner?.error?.code === -6004) {
    const note = inner.error.note ? `: ${inner.error.note}` : '';
    throw new DownloadError(
      `Youku risk control rejected the request (-6004) — usually rate limiting from frequent mints (wait 10-30 min and retry), ` +
        `not expired cookies; if it persists, re-export cookies from the browser making sure the cna cookie is included${note}`,
      'https://www.youku.tv/',
    );
  }
  if (inner?.error?.code !== undefined) {
    const note = inner.error?.note ? `: ${inner.error.note}` : '';
    throw new DownloadError(`Youku ups error ${inner.error.code}${note}`, 'https://www.youku.tv/');
  }
  if (inner?.trial && !options?.allowTrial) {
    throw new DownloadError(
      'Youku: the server issued a 6-minute trial — for TVOD (paid) episodes this is normal even with valid cookies ' +
        '(set download.subsBeforeVideo: true to fetch subtitles now); otherwise cookies are logged out or expired — re-export them from a logged-in browser session',
      'https://www.youku.tv/',
    );
  }

  return {
    title: inner?.video?.title ?? '',
    seconds: inner?.video?.seconds ?? 0,
    maxStreamLevel: inner?.controller?.max_stream_level ?? null,
    streams: (inner?.stream ?? []).map((s) => ({
      stream_type: String(s.stream_type ?? ''),
      width: Number(s.width ?? 0),
      height: Number(s.height ?? 0),
      drm_type: s.drm_type,
      m3u8_url: String(s.m3u8_url ?? ''),
    })),
    subtitles: (inner?.subtitle ?? []).map((s) => ({
      subtitle_lang: String(s.subtitle_lang ?? ''),
      url: String(s.url ?? ''),
    })),
    trial: Boolean(inner?.trial),
  };
}

export type PickedYoukuStream = { stream: YoukuStream; degraded: boolean };

/**
 * Best downloadable stream: highest height among streams with a real playlist
 * URL. The `auto` entry carries inline master-playlist text in `m3u8_url` (not
 * a URL) and is skipped; DRM-labeled streams (drm_type other than "default")
 * never appear in plain responses but are excluded defensively.
 */
export function pickBestStream(streams: YoukuStream[]): PickedYoukuStream {
  const height = (s: YoukuStream) => s.height || 0;
  const usable = streams.filter(
    (s) => s.m3u8_url.startsWith('http') && (s.drm_type === undefined || s.drm_type === 'default'),
  );

  const bestOverall = streams.reduce<YoukuStream | null>((a, b) => (a === null || height(b) > height(a) ? b : a), null);
  if (bestOverall === null) {
    throw new DownloadError('Youku returned no streams for this episode', '');
  }
  const bestUsable = usable.reduce<YoukuStream | null>((a, b) => (a === null || height(b) > height(a) ? b : a), null);
  if (bestUsable === null) {
    throw new DownloadError('All Youku streams are DRM-protected or unusable', '');
  }
  return { stream: bestUsable, degraded: height(bestOverall) > height(bestUsable) };
}

/** Filename tag for a subtitle track; Youku's `default` is the simplified-Chinese track. */
export function subtitleLangTag(sub: YoukuSubtitle): string {
  return sub.subtitle_lang === 'default' ? 'chs' : sub.subtitle_lang.toLowerCase();
}

/**
 * Aliases letting the shared `zh`-family config patterns (`zh.*`, `zho.*`,
 * `zh-hans`, …) reach Youku's idiosyncratic `chs`/`cht` track codes — on MGTV
 * `zh.*` already matches `zh_cn`/`zh_hk`, so user config carries over.
 */
const ZH_TAG_ALIASES: Record<string, string[]> = {
  chs: ['zh', 'zho', 'zh-hans'],
  cht: ['zh', 'zho', 'zh-hant'],
};

/**
 * Match subtitle entries against config `subLangs` patterns (yt-dlp-style
 * globs, same semantics as the MGTV matcher): `chs.*`/`chs*` → prefix match,
 * `chs` (no asterisk) → exact match. Patterns compare against the filename tag
 * (`chs`, `cht`, `en`, …) and, for the Chinese tracks, their `zh`-family
 * aliases.
 */
export function matchYoukuSubLangs(subs: YoukuSubtitle[], subLangs: string[]): YoukuSubtitle[] {
  if (subLangs.length === 0) return [];

  const patterns = subLangs.map((pattern) => {
    const base = pattern.toLowerCase().replace(/\.\*$/, '').replace(/\*$/, '');
    return { base, exact: !pattern.includes('*') };
  });

  return subs.filter((s) => {
    const tag = subtitleLangTag(s);
    if (!tag) return false;
    const names = [tag, ...(ZH_TAG_ALIASES[tag] ?? [])];
    return patterns.some((p) => names.some((name) => (p.exact ? name === p.base : name.startsWith(p.base))));
  });
}

/**
 * Fetch an unsigned subtitle file from the Youku CDN. Cookies are never sent:
 * the CDN is a different company domain and the URLs need no auth (verified).
 */
export async function fetchSubtitle(url: string): Promise<string> {
  let text: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Referer: 'https://www.youku.tv/' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new DownloadError(`Youku subtitle HTTP ${res.status}`, url);
    }
    text = await res.text();
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError(
      `Youku subtitle request failed: ${error instanceof Error ? error.message : String(error)}`,
      url,
    );
  }
  return text;
}

/** Extract the encodevid from an episode URL (accepts the `id_` prefix or none; any `XN…` encodevid matches). */
export function extractVideoId(url: string): string | null {
  const match = url.match(/\/v_show\/(?:id_)?(XN[A-Za-z0-9+/=]+)\.html/);
  return match ? (match[1] ?? null) : null;
}

/** Injectable surface of everything YoukuDownloader needs from this module. */
export type YoukuApi = {
  extractVideoId(url: string): string | null;
  readYoukuCookiePairs(cookieFile: string): Promise<string[]>;
  mintUps(vid: string, cookiePairs: string[], options?: { allowTrial?: boolean }): Promise<YoukuUpsResult>;
  fetchSubtitle(url: string): Promise<string>;
};

export const youkuApi: YoukuApi = {
  extractVideoId,
  readYoukuCookiePairs,
  mintUps,
  fetchSubtitle,
};
