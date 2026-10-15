import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieError, DownloadError } from '../../errors/custom-errors.js';
import {
  extractVideoId,
  fetchSubtitle,
  matchYoukuSubLangs,
  mintUps,
  mtopGet,
  mtopSign,
  pickBestStream,
  readYoukuCookiePairs,
  subtitleLangTag,
} from './youku-api';

describe('mtopSign', () => {
  it('produces the golden-vector signature for fixed inputs', () => {
    // md5(token & t & appKey & data) — verified against the live gateway 2026-10-16
    expect(mtopSign('0123456789abcdef0123456789abcdef', '1700000000000', JSON.stringify({ steal_params: 'x' }))).toBe(
      '3ad223ddcab4788734b211112f5b5fb5',
    );
    expect(mtopSign('abc123', '1699999999999', '{"a":1}')).toBe('26800055d6e61955d1209db596fb0e97');
  });
});

describe('readYoukuCookiePairs', () => {
  // Netscape format: domain \t flag \t path \t secure \t expiry \t name \t value
  const NETSCAPE = [
    '# Netscape HTTP Cookie File',
    '# This is a generated file! Do not edit.',
    '',
    '.openai.com\tTRUE\t/\tTRUE\t0\t__Secure-next-auth.session-token\tSECRET-MUST-NOT-LEAK',
    '.alipay.com\tTRUE\t/\tTRUE\t1780000000\tcna\tALIPAY-SECRET',
    '.youku.tv\tTRUE\t/\tFALSE\t1790000000\tcna\tCNA-DEVICE-ID',
    '.youku.tv\tTRUE\t/\tFALSE\t1790000000\tcna\tduplicate-domain-skipped',
    'www.youku.tv\tFALSE\t/\tFALSE\t1790000000\tcsrfToken\tcsrf-42',
    '.www.youku.tv\tTRUE\t/\tFALSE\t1790000000\tP_F\tf-token',
    '.youku.com\tTRUE\t/\tTRUE\t1790000000\tsid\tCOMVAL',
    'evil-youku.tv\tTRUE\t/\tTRUE\t1790000000\tspoof\tMUST-NOT-LEAK',
    'youku.tv.evil.com\tTRUE\t/\tTRUE\t1790000000\tspoof2\tMUST-NOT-LEAK-EITHER',
    'short-line',
    '',
  ].join('\n');

  it('keeps only youku.tv/youku.com cookies, dedupes by name+domain, preserves order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'youku-cookie-test-'));
    const file = join(dir, 'cookies.txt');
    await writeFile(file, NETSCAPE, 'utf-8');

    const pairs = await readYoukuCookiePairs(file);

    expect(pairs).toEqual(['cna=CNA-DEVICE-ID', 'csrfToken=csrf-42', 'P_F=f-token', 'sid=COMVAL']);
    expect(pairs.join('; ')).not.toContain('MUST-NOT-LEAK');
    expect(pairs.join('; ')).not.toContain('ALIPAY-SECRET');
  });

  it('throws CookieError when the file has no youku cookies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'youku-cookie-test-'));
    const file = join(dir, 'cookies.txt');
    await writeFile(file, '.example.com\tTRUE\t/\tTRUE\t0\tfoo\tbar', 'utf-8');

    await expect(readYoukuCookiePairs(file)).rejects.toThrow(CookieError);
  });

  it('throws CookieError when the file does not exist', async () => {
    await expect(readYoukuCookiePairs('Z:/definitely/not/here.txt')).rejects.toThrow(CookieError);
  });

  it('parses #HttpOnly_ cookies and handles CRLF line endings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'youku-cookie-test-'));
    const file = join(dir, 'cookies.txt');
    // \r\n line endings are what Windows exports produce
    await writeFile(
      file,
      [
        '#HttpOnly_.youku.tv\tTRUE\t/\tFALSE\t1790000000\tP_sck\thttponly-session',
        '.openai.com\tTRUE\t/\tTRUE\t0\tk\tv',
      ].join('\r\n'),
      'utf-8',
    );

    const pairs = await readYoukuCookiePairs(file);
    expect(pairs).toEqual(['P_sck=httponly-session']);
  });
});

describe('mtopGet', () => {
  const originalFetch = global.fetch;
  let captured: { url: string; headers: Record<string, string> }[];

  beforeEach(() => {
    captured = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /** Stub fetch with a queue of scripted responses (last one repeats). */
  function stubFetch(responses: { body: string; setCookie?: string }[]) {
    let call = 0;
    global.fetch = mock(async (input: any, init?: any) => {
      captured.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
      const r = responses[Math.min(call++, responses.length - 1)]!;
      const headers: Record<string, string> = {};
      if (r.setCookie) headers['set-cookie'] = r.setCookie;
      return new Response(r.body, { status: 200, headers });
    }) as unknown as typeof fetch;
  }

  it('builds the signed gateway URL and unwraps the JSONP envelope', async () => {
    stubFetch([
      {
        body: 'mtopjsonp1({"api":"mtop.youku.play.ups.appinfo.get","ret":["SUCCESS::ok"],"data":{"data":{"answer":42}}})',
      },
    ]);

    const data = await mtopGet('mtop.youku.play.ups.appinfo.get', '1.1', { a: 1 }, ['_m_h5_tk=TOKEN1_1790000000']);

    expect(data).toEqual({ answer: 42 });
    const url = new URL(captured[0]!.url);
    expect(url.origin + url.pathname).toBe('https://acs.youku.tv/h5/mtop.youku.play.ups.appinfo.get/1.1/');
    expect(url.searchParams.get('api')).toBe('mtop.youku.play.ups.appinfo.get');
    expect(url.searchParams.get('v')).toBe('1.1');
    expect(url.searchParams.get('appKey')).toBe('34300712');
    expect(url.searchParams.get('type')).toBe('jsonp');
    const dataStr = url.searchParams.get('data')!;
    expect(JSON.parse(dataStr)).toEqual({ a: 1 });
    // sign is computed from the token in the cookie pairs and the SAME t/data
    expect(url.searchParams.get('sign')).toBe(mtopSign('TOKEN1', url.searchParams.get('t')!, dataStr));
    expect(captured[0]!.headers.Cookie).toBe('_m_h5_tk=TOKEN1_1790000000');
    expect(captured[0]!.headers.Referer).toBe('https://www.youku.tv/');
    expect(captured[0]!.headers['User-Agent']).toContain('Mozilla/5.0');
  });

  it('performs the token dance: patches set-cookie tokens into the pairs and retries once', async () => {
    stubFetch([
      {
        body: 'mtopjsonp1({"api":"x","data":{},"ret":["FAIL_SYS_TOKEN_EXPIRED::令牌过期"]})',
        setCookie:
          '_m_h5_tk=NEWTOK123_1791111111; Path=/; Domain=.youku.tv, _m_h5_tk_enc=ENC123_1791111111; Path=/; Domain=.youku.tv',
      },
      {
        body: 'mtopjsonp1({"api":"x","ret":["SUCCESS::ok"],"data":{"data":{"retried":true}}})',
      },
    ]);
    const pairs = ['_m_h5_tk=OLD_1', '_m_h5_tk_enc=OLDE_1', 'cna=CNA-1'];

    const data = await mtopGet('mtop.youku.play.ups.appinfo.get', '1.1', { a: 1 }, pairs);

    expect(data).toEqual({ retried: true });
    expect(captured).toHaveLength(2);
    // cookie header was patched in place: old tokens replaced, cna preserved
    expect(captured[1]!.headers.Cookie).toContain('_m_h5_tk=NEWTOK123_1791111111');
    expect(captured[1]!.headers.Cookie).toContain('_m_h5_tk_enc=ENC123_1791111111');
    expect(captured[1]!.headers.Cookie).toContain('cna=CNA-1');
    expect(captured[1]!.headers.Cookie).not.toContain('OLD_1');
    expect(captured[1]!.headers.Cookie).not.toContain('OLDE_1');
    // second call re-signed with the NEW token
    const url2 = new URL(captured[1]!.url);
    expect(url2.searchParams.get('sign')).toBe(
      mtopSign('NEWTOK123', url2.searchParams.get('t')!, url2.searchParams.get('data')!),
    );
  });

  it('throws DownloadError when the token still fails after the retry', async () => {
    stubFetch([
      {
        body: 'mtopjsonp1({"api":"x","data":{},"ret":["FAIL_SYS_TOKEN_EXPIRED::令牌过期"]})',
        setCookie: '_m_h5_tk=NEWTOK123_1791111111; Path=/',
      },
      { body: 'mtopjsonp1({"api":"x","data":{},"ret":["FAIL_SYS_TOKEN_FORBIDDEN::拒绝"]})' },
    ]);

    await expect(mtopGet('mtop.youku.play.ups.appinfo.get', '1.1', {}, ['cna=1'])).rejects.toThrow(
      /FAIL_SYS_TOKEN_FORBIDDEN/,
    );
  });

  it('throws DownloadError on non-SUCCESS ret without retrying', async () => {
    stubFetch([{ body: 'mtopjsonp1({"api":"x","data":{},"ret":["FAIL_SYS_PARAM_ERROR::bad param"]})' }]);

    await expect(mtopGet('mtop.youku.play.ups.appinfo.get', '1.1', {}, [])).rejects.toThrow(/FAIL_SYS_PARAM_ERROR/);
    expect(captured).toHaveLength(1);
  });

  it('throws DownloadError on an unparseable response body', async () => {
    stubFetch([{ body: '<html>502 Bad Gateway</html>' }]);

    await expect(mtopGet('mtop.youku.play.ups.appinfo.get', '1.1', {}, [])).rejects.toThrow(DownloadError);
  });

  it('wraps network failures in DownloadError', async () => {
    global.fetch = mock(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(mtopGet('mtop.youku.play.ups.appinfo.get', '1.1', {}, ['cna=1'])).rejects.toThrow(
      /Youku request failed/,
    );
  });
});

describe('mintUps', () => {
  const originalFetch = global.fetch;
  let captured: { url: string; headers: Record<string, string> }[];

  beforeEach(() => {
    captured = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function stubFetch(body: string) {
    global.fetch = mock(async (input: any, init?: any) => {
      captured.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
  }

  /** Realistic ups payload (shape copied from live responses 2026-10-15/16). */
  const UPS_OK = JSON.stringify({
    api: 'mtop.youku.play.ups.appinfo.get',
    ret: ['SUCCESS::调用成功'],
    data: {
      data: {
        controller: { max_stream_level: 4 },
        video: { title: 'Good Night 08', seconds: 2749.32 },
        stream: [
          { stream_type: 'auto', width: 640, height: 360, drm_type: 'default', m3u8_url: '#EXTM3U inline text' },
          {
            stream_type: 'cmfv4sd',
            width: 640,
            height: 360,
            drm_type: 'default',
            m3u8_url: 'http://pl-ali.youku.tv/sd.m3u8?x=1',
          },
          {
            stream_type: 'cmfv4hd',
            width: 864,
            height: 486,
            drm_type: 'default',
            m3u8_url: 'http://pl-ali.youku.tv/hd.m3u8?x=1',
          },
          {
            stream_type: 'cmfv4hd2',
            width: 1280,
            height: 720,
            drm_type: 'default',
            m3u8_url: 'http://pl-ali.youku.tv/hd2.m3u8?x=1',
          },
        ],
        subtitle: [
          { subtitle_lang: 'default', url: 'http://sub.ykimg.com/chs.ass' },
          { subtitle_lang: 'cht', url: 'http://sub.ykimg.com/cht.ass' },
          { subtitle_lang: 'en', url: 'http://sub.ykimg.com/en.ass' },
        ],
      },
    },
  });

  it('mints the ups payload and maps the result', async () => {
    stubFetch(`mtopjsonp1(${UPS_OK})`);
    const pairs = ['cna=CNA-DEVICE-ID-24', '_m_h5_tk=T_1'];

    const ups = await mintUps('XNjU3NzMxMTcxNg==', pairs);

    expect(ups.title).toBe('Good Night 08');
    expect(ups.seconds).toBe(2749.32);
    expect(ups.maxStreamLevel).toBe(4);
    expect(ups.streams).toHaveLength(4);
    expect(ups.subtitles).toHaveLength(3);

    // request template: cna is the utid, no ckey, vid/local_vid = target, ad_params "{}"
    const dataObj = JSON.parse(new URL(captured[0]!.url).searchParams.get('data')!);
    const sp = JSON.parse(dataObj.steal_params);
    expect(sp.utid).toBe('CNA-DEVICE-ID-24');
    expect(sp.ccode).toBe('0597');
    expect(sp).not.toHaveProperty('ckey');
    expect(typeof sp.client_ts).toBe('number');
    const biz = JSON.parse(dataObj.biz_params);
    expect(biz.vid).toBe('XNjU3NzMxMTcxNg==');
    expect(biz.local_vid).toBe('XNjU3NzMxMTcxNg==');
    expect(biz.master_m3u8).toBe(1);
    expect(dataObj.ad_params).toBe('{}');
  });

  it('falls back to a generated utid when cna is absent', async () => {
    stubFetch(`mtopjsonp1(${UPS_OK})`);

    await mintUps('XNjU3NzMxMTcxNg==', ['_m_h5_tk=T_1']);

    const dataObj = JSON.parse(new URL(captured[0]!.url).searchParams.get('data')!);
    const sp = JSON.parse(dataObj.steal_params);
    expect(typeof sp.utid).toBe('string');
    expect(sp.utid.length).toBeGreaterThan(0);
  });

  it('throws DownloadError with a re-export hint on risk control -6004', async () => {
    stubFetch(
      'mtopjsonp1({"ret":["SUCCESS::调用成功"],"data":{"data":{"ups":{},"error":{"code":-6004,"note":"该账号检测到有可疑违规、侵权等行为，已限制播放"}}}})',
    );

    await expect(mintUps('XNjU3NzMxMTcxNg==', ['cna=1'])).rejects.toThrow(/-6004.*cna/s);
  });

  it('throws DownloadError on a trial response (not logged in / cookies expired)', async () => {
    stubFetch(
      'mtopjsonp1({"ret":["SUCCESS::调用成功"],"data":{"data":{"controller":{"max_stream_level":4},"video":{"title":"Good Night 08","seconds":2749.32},"stream":[{"stream_type":"cmfv4hd2","width":1280,"height":720,"drm_type":"default","m3u8_url":"http://pl-ali.youku.tv/hd2.m3u8?x=1"}],"subtitle":[],"trial":{"trial_str":"您可以免费试看前6分钟","time":360,"type":"time"}}}})',
    );

    await expect(mintUps('XNjU3NzMxMTcxNg==', ['cna=1'])).rejects.toThrow(/trial|logged in|cookies/i);
  });
});

describe('pickBestStream', () => {
  it('picks the highest non-DRM stream with a real playlist URL (auto is inline text)', () => {
    const { stream, degraded } = pickBestStream([
      { stream_type: 'auto', width: 640, height: 360, drm_type: 'default', m3u8_url: '#EXTM3U inline text' },
      { stream_type: 'cmfv4sd', width: 640, height: 360, drm_type: 'default', m3u8_url: 'http://x/sd.m3u8' },
      { stream_type: 'cmfv4hd', width: 864, height: 486, drm_type: 'default', m3u8_url: 'http://x/hd.m3u8' },
      { stream_type: 'cmfv4hd2', width: 1280, height: 720, drm_type: 'default', m3u8_url: 'http://x/hd2.m3u8' },
    ]);
    expect(stream.stream_type).toBe('cmfv4hd2');
    expect(degraded).toBe(false);
  });

  it('skips DRM-labeled streams and reports the degradation', () => {
    const { stream, degraded } = pickBestStream([
      { stream_type: 'cmfv4hd3', width: 1920, height: 1080, drm_type: 'widevine', m3u8_url: 'http://x/hd3.m3u8' },
      { stream_type: 'cmfv4hd', width: 864, height: 486, drm_type: 'default', m3u8_url: 'http://x/hd.m3u8' },
    ]);
    expect(stream.stream_type).toBe('cmfv4hd');
    expect(degraded).toBe(true);
  });

  it('throws when there are no streams at all', () => {
    expect(() => pickBestStream([])).toThrow(DownloadError);
  });

  it('throws when every stream is DRM or inline text', () => {
    expect(() =>
      pickBestStream([
        { stream_type: 'auto', width: 640, height: 360, drm_type: 'default', m3u8_url: '#EXTM3U inline text' },
        { stream_type: 'cmfv4hd3', width: 1920, height: 1080, drm_type: 'widevine', m3u8_url: 'http://x/hd3.m3u8' },
      ]),
    ).toThrow(DownloadError);
  });
});

describe('matchYoukuSubLangs / subtitleLangTag', () => {
  const SUBS = [
    { subtitle_lang: 'default', url: 'http://sub.ykimg.com/chs.ass' },
    { subtitle_lang: 'cht', url: 'http://sub.ykimg.com/cht.ass' },
    { subtitle_lang: 'en', url: 'http://sub.ykimg.com/en.ass' },
    { subtitle_lang: 'kr', url: 'http://sub.ykimg.com/kr.ass' },
  ];

  it('maps default to chs and matches prefix and exact patterns', () => {
    expect(subtitleLangTag(SUBS[0]!)).toBe('chs');
    expect(subtitleLangTag(SUBS[1]!)).toBe('cht');

    expect(matchYoukuSubLangs(SUBS, ['chs', 'en']).map((s) => s.subtitle_lang)).toEqual(['default', 'en']);
    expect(matchYoukuSubLangs(SUBS, ['zh.*']).map((s) => s.subtitle_lang)).toEqual([]);
    expect(matchYoukuSubLangs(SUBS, ['c']).map((s) => s.subtitle_lang)).toEqual([]);
    expect(matchYoukuSubLangs(SUBS, ['c*']).map((s) => s.subtitle_lang)).toEqual(['default', 'cht']);
    expect(matchYoukuSubLangs(SUBS, [])).toEqual([]);
  });
});

describe('extractVideoId', () => {
  it('extracts the encodevid with and without the id_ prefix', () => {
    expect(extractVideoId('https://www.youku.tv/v/v_show/id_XNjU3NzMxMTcxNg==.html')).toBe('XNjU3NzMxMTcxNg==');
    expect(extractVideoId('https://www.youku.tv/v/v_show/XNjU2Mzg5MzA4OA==.html')).toBe('XNjU2Mzg5MzA4OA==');
  });

  it('returns null for non-episode URLs and garbage', () => {
    expect(extractVideoId('https://www.youku.tv/nowplaying')).toBeNull();
    expect(extractVideoId('not a url')).toBeNull();
  });
});

describe('fetchSubtitle', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches the subtitle text without cookies', async () => {
    let capturedInit: any;
    global.fetch = mock(async (_input: any, init?: any) => {
      capturedInit = init;
      return new Response('SUBTITLE TEXT', { status: 200 });
    }) as unknown as typeof fetch;

    const text = await fetchSubtitle('http://sub.ykimg.com/en.ass');
    expect(text).toBe('SUBTITLE TEXT');
    expect(capturedInit?.headers?.Referer).toBe('https://www.youku.tv/');
    expect(capturedInit?.headers).not.toHaveProperty('Cookie');
  });

  it('throws DownloadError on HTTP errors', async () => {
    global.fetch = mock(async () => new Response('gone', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchSubtitle('http://sub.ykimg.com/en.ass')).rejects.toThrow(DownloadError);
  });
});
