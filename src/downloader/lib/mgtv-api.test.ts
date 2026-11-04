import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { CookieError, DownloadError } from '../../errors/custom-errors.js';
import { queueModuleRestore } from '../../test-utils/queue-module-restore';
import type { FirefoxCookie } from '../../utils/firefox-cookies.js';
import {
  downloadSubtitle,
  extractVideoId,
  fetchPlayerInfo,
  fetchSourceStreams,
  fetchSubtitleList,
  makeTk2,
  mgtvFetchJson,
  readMgtvCookieHeader,
  resolveM3u8Url,
  resolveSubtitleUrl,
} from './mgtv-api';

const mockReadFirefoxCookies = mock(async () => [] as FirefoxCookie[]);

mock.module('../../utils/firefox-cookies.js', () => ({
  readFirefoxCookies: mockReadFirefoxCookies,
  readCookieHeaderForUrl: mock(async () => ''),
}));
queueModuleRestore('../../utils/firefox-cookies.js', import.meta.dir);

describe('makeTk2', () => {
  it('produces the golden-vector signature for a fixed did and clit', () => {
    // Verified against the live MGTV player (2026-10-14)
    expect(makeTk2('00000000-0000-4000-8000-000000000000', 1700000000)).toBe(
      'wADMwADMwAzNx0Ddpx2Y8FDMzAjLz4CM9IXZ2xHMzATM98mbwxHMwADMwADMwADMwATLwADM40CMwADNtADMwATLwADMwADMwATPklGZ',
    );
  });

  it('defaults clit to current unix time when omitted', () => {
    const before = Math.floor(Date.now() / 1000);
    const tk2 = makeTk2('11111111-1111-4111-8111-111111111111');
    const after = Math.floor(Date.now() / 1000);
    // Decode the tk2: un-reverse, restore base64 chars, decode
    const restored = tk2.split('').reverse().join('').replace(/_/g, '+').replace(/~/g, '/').replace(/-/g, '=');
    const raw = Buffer.from(restored, 'base64').toString('utf-8');
    const clit = Number(raw.match(/clit=(\d+)/)?.[1]);
    expect(clit).toBeGreaterThanOrEqual(before);
    expect(clit).toBeLessThanOrEqual(after);
    expect(tk2).not.toMatch(/[+/=]/);
  });
});

describe('extractVideoId', () => {
  it('extracts the id from a w.mgtv.com episode URL', () => {
    expect(extractVideoId('https://w.mgtv.com/b/908834/24677071.html')).toBe('24677071');
  });

  it('extracts the id from a mgtv.com episode URL', () => {
    expect(extractVideoId('https://mgtv.com/b/823701/23967831.html')).toBe('23967831');
  });

  it('returns null for URLs without an episode path', () => {
    expect(extractVideoId('https://w.mgtv.com/some/other/page')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(extractVideoId('not a url')).toBeNull();
  });
});

describe('readMgtvCookieHeader', () => {
  beforeEach(() => {
    mockReadFirefoxCookies.mockClear();
    mockReadFirefoxCookies.mockResolvedValue([]);
  });

  it('keeps only mgtv.com cookies from the Firefox profile', async () => {
    mockReadFirefoxCookies.mockResolvedValue([
      { name: 'PHPSESSID', value: 'abc123', domain: '.mgtv.com', path: '/', secure: true, expiry: 1790000000 },
      { name: 'sessionid', value: 'vip-session-42', domain: 'w.mgtv.com', path: '/', secure: true, expiry: 1790000000 },
      {
        name: '__Secure-next-auth.session-token',
        value: 'SECRET-MUST-NOT-LEAK',
        domain: '.openai.com',
        path: '/',
        secure: true,
        expiry: 0,
      },
      { name: 'cna', value: 'ALIPAY-SECRET', domain: '.alipay.com', path: '/', secure: true, expiry: 1780000000 },
      {
        name: 'spoof',
        value: 'MUST-NOT-LEAK',
        domain: 'evil-mgtv.com.attacker.com',
        path: '/',
        secure: true,
        expiry: 1790000000,
      },
    ]);

    const header = await readMgtvCookieHeader('firefox:default-release');

    expect(header).toBe('PHPSESSID=abc123; sessionid=vip-session-42');
    expect(header).not.toContain('SECRET-MUST-NOT-LEAK');
    expect(header).not.toContain('ALIPAY-SECRET');
    expect(header).not.toContain('MUST-NOT-LEAK');
    expect(mockReadFirefoxCookies).toHaveBeenCalledWith('firefox:default-release', { url: 'https://w.mgtv.com/' });
  });

  it('throws CookieError when the profile has no mgtv.com cookies', async () => {
    mockReadFirefoxCookies.mockResolvedValue([
      { name: 'foo', value: 'bar', domain: '.example.com', path: '/', secure: true, expiry: 0 },
    ]);

    await expect(readMgtvCookieHeader('firefox:default-release')).rejects.toThrow(CookieError);
  });

  it('propagates CookieError from the Firefox profile reader', async () => {
    mockReadFirefoxCookies.mockRejectedValue(new CookieError('Firefox profile "nope": cookies.sqlite not found'));

    await expect(readMgtvCookieHeader('firefox:nope')).rejects.toThrow(CookieError);
  });
});

describe('mgtvFetchJson', () => {
  const originalFetch = global.fetch;
  let _capturedUrl: string | undefined;
  let capturedHeaders: Record<string, string>;

  beforeEach(() => {
    _capturedUrl = undefined;
    capturedHeaders = {};
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function stubFetch(body: string, status = 200) {
    global.fetch = mock(async (input: any, init?: any) => {
      _capturedUrl = String(input);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(body, { status });
    }) as unknown as typeof fetch;
  }

  it('parses a plain JSON response', async () => {
    stubFetch('{"code":200,"msg":"","data":{"ok":1}}');
    const data = await mgtvFetchJson('https://tinker.glb.mgtv.com/x');
    expect(data.data.ok).toBe(1);
  });

  it('parses a JSONP response', async () => {
    stubFetch('jsonp_1760000000000_1({"code":200,"msg":"","data":{"ok":2}})');
    const data = await mgtvFetchJson('https://tinker.glb.mgtv.com/x');
    expect(data.data.ok).toBe(2);
  });

  it('sends browser headers and the cookie header only to mgtv.com hosts', async () => {
    stubFetch('{"code":200}');

    await mgtvFetchJson('https://tinker.glb.mgtv.com/player/video?a=1', 'PHPSESSID=abc; sessionid=vip');
    expect(capturedHeaders['User-Agent']).toContain('Mozilla/5.0');
    expect(capturedHeaders.Referer).toBe('https://w.mgtv.com/');
    expect(capturedHeaders.Cookie).toBe('PHPSESSID=abc; sessionid=vip');

    // Non-mgtv host: same call, but cookies must NOT be attached
    await mgtvFetchJson('https://subtitle.hitv.com/x.srt', 'PHPSESSID=abc; sessionid=vip');
    expect(capturedHeaders.Cookie).toBeUndefined();
  });

  it('throws DownloadError with the API msg when code != 200', async () => {
    stubFetch('{"code":404,"msg":"video not found"}');
    await expect(mgtvFetchJson('https://tinker.glb.mgtv.com/x')).rejects.toThrow(DownloadError);
    await expect(mgtvFetchJson('https://tinker.glb.mgtv.com/x')).rejects.toThrow('video not found');
  });

  it('includes the API info field in the error when msg is absent (titan busy)', async () => {
    // Real body from disp-glb.titan.mgtv.com/atcl during the 2026-11-04 outage
    stubFetch('{"isothercdn":0,"info":"busy","status":"error","code":618}');
    await expect(mgtvFetchJson('https://disp-glb.titan.mgtv.com/atcl?x=1')).rejects.toThrow(
      'MGTV API error (code 618)',
    );
    await expect(mgtvFetchJson('https://disp-glb.titan.mgtv.com/atcl?x=1')).rejects.toThrow('busy');
  });

  it('does not treat a missing code field as an error (subtitle vod.do has status only)', async () => {
    stubFetch('{"ver":"1.0","status":"ok","info":"https://x/example.srt"}');
    const data = await mgtvFetchJson('https://disp-glb.titan.mgtv.com/vod.do?x=1');
    expect(data.info).toBe('https://x/example.srt');
  });

  it('throws DownloadError on unparseable responses', async () => {
    stubFetch('<html>502 Bad Gateway</html>');
    await expect(mgtvFetchJson('https://tinker.glb.mgtv.com/x')).rejects.toThrow(DownloadError);
  });

  it('throws DownloadError on non-200 HTTP status even when the body has no code field', async () => {
    stubFetch('{"status":"error"}', 502);
    await expect(mgtvFetchJson('https://disp-glb.titan.mgtv.com/vod.do?x=1')).rejects.toThrow(DownloadError);
    await expect(mgtvFetchJson('https://disp-glb.titan.mgtv.com/vod.do?x=1')).rejects.toThrow('MGTV API HTTP 502');
  });

  it('never sends cookies to mgtv lookalike hosts', async () => {
    stubFetch('{"code":200}');
    const lookalikes = ['https://evil-mgtv.com/x', 'https://mgtv.com.attacker.com/x', 'https://x.mgtv.com.evil.com/x'];
    for (const url of lookalikes) {
      await mgtvFetchJson(url, 'PHPSESSID=abc');
      expect(capturedHeaders).not.toHaveProperty('Cookie');
    }
  });

  it('attaches cookies to an uppercase mgtv.com hostname (URL lowercases it)', async () => {
    stubFetch('{"code":200}');
    await mgtvFetchJson('https://TINKER.GLB.MGTV.COM/x', 'PHPSESSID=abc');
    expect(capturedHeaders.Cookie).toBe('PHPSESSID=abc');
  });
});

describe('MGTV endpoints (mocked fetch)', () => {
  const originalFetch = global.fetch;
  let captured: { url: string; headers: Record<string, string> }[];

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function stubFetch(responses: string[]) {
    captured = [];
    let call = 0;
    global.fetch = mock(async (input: any, init?: any) => {
      captured.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(responses[Math.min(call++, responses.length - 1)], { status: 200 });
    }) as unknown as typeof fetch;
  }

  it('fetchPlayerInfo extracts pm2 and account status', async () => {
    stubFetch([
      JSON.stringify({
        code: 200,
        data: {
          atc: { pm2: 'pm2-token-xyz' },
          user: { login: true, isvip: '1' },
          info: { title: 'EP10 夜色将烬', duration: 989 },
        },
      }),
    ]);

    const info = await fetchPlayerInfo('24677071', 'sessionid=vip');
    expect(info).toEqual({
      pm2: 'pm2-token-xyz',
      login: true,
      isvip: true,
      title: 'EP10 夜色将烬',
      duration: 989,
    });
    expect(captured[0]!.url).toContain('https://tinker2.glb.mgtv.com/player/video?');
    expect(captured[0]!.url).toContain('video_id=24677071');
    expect(captured[0]!.url).toMatch(/tk2=[A-Za-z0-9~-]+/);
    expect(captured[0]!.headers.Cookie).toBe('sessionid=vip');
  });

  it('fetchSourceStreams maps streams and picks stream_domain[0]', async () => {
    stubFetch([
      JSON.stringify({
        code: 200,
        data: {
          stream_domain: ['https://disp-glb.titan.mgtv.com', 'https://backup.titan.mgtv.com'],
          stream: [
            { name: '720P', filebitrate: '757', vip: '0', url: '/atcl/x?a=1' },
            { name: '1080P SDR', filebitrate: '1541', vip: '1', url: '/atcl/y?arange=2&b=2' },
          ],
        },
      }),
    ]);

    const source = await fetchSourceStreams('24677071', 'pm2-token', 'sessionid=vip');
    expect(source.streamDomain).toBe('https://disp-glb.titan.mgtv.com');
    expect(source.streams).toEqual([
      { name: '720P', filebitrate: '757', vip: '0', url: '/atcl/x?a=1' },
      { name: '1080P SDR', filebitrate: '1541', vip: '1', url: '/atcl/y?arange=2&b=2' },
    ]);
    expect(captured[0]!.url).toContain('https://tinker.glb.mgtv.com/player/getSource?');
    expect(captured[0]!.url).toContain('pm2=pm2-token');
    expect(captured[0]!.url).toContain('auth_mode=1');
  });

  it('resolveM3u8Url strips arange and returns the signed playlist URL', async () => {
    stubFetch(['jsonp_1_1({"info":"https://pcvideoaliyun.mgtv.com/playlist.m3u8?mac=abc"})']);

    const m3u8 = await resolveM3u8Url('https://disp-glb.titan.mgtv.com', '/atcl/y?pm=1&arange=2&fid=3');
    expect(m3u8).toBe('https://pcvideoaliyun.mgtv.com/playlist.m3u8?mac=abc');
    expect(captured[0]!.url).toBe('https://disp-glb.titan.mgtv.com/atcl/y?pm=1&fid=3');
  });

  it('resolveM3u8Url throws when info is missing', async () => {
    stubFetch(['{"code":200,"data":{}}']);
    await expect(resolveM3u8Url('https://disp-glb.titan.mgtv.com', '/atcl/y')).rejects.toThrow(DownloadError);
  });

  it('fetchSubtitleList maps captionSimpleName to code and skips entries without url', async () => {
    stubFetch([
      JSON.stringify({
        code: 200,
        data: {
          title: [
            { name: 'Русский', captionSimpleName: 'RU', language: 'ru', url: '/vod.do?pm=1&fid=2' },
            { name: 'English', captionSimpleName: 'EN', language: 'en', url: '' },
            { name: '简体中文', captionSimpleName: 'ZH_CN', language: 'zh-cn', url: '/vod.do?pm=3&fid=4' },
          ],
        },
      }),
    ]);

    const subs = await fetchSubtitleList('24677071', 'sessionid=vip');
    expect(subs).toEqual([
      { name: 'Русский', code: 'RU', url: '/vod.do?pm=1&fid=2' },
      { name: '简体中文', code: 'ZH_CN', url: '/vod.do?pm=3&fid=4' },
    ]);
    expect(captured[0]!.url).toContain('https://tinker.glb.mgtv.com/video/title?videoId=24677071');
  });

  it('resolveSubtitleUrl + downloadSubtitle fetch the signed srt without cookies', async () => {
    stubFetch([
      'jsonp_2_1({"status":"ok","info":"https://subtitle.hitv.com/ru.srt?sign=x"})',
      '1\n00:00:01,000 --> 00:00:02,000\nПривет\n',
    ]);

    const srtUrl = await resolveSubtitleUrl({ name: 'Русский', code: 'RU', url: '/vod.do?pm=1&fid=2' });
    expect(srtUrl).toBe('https://subtitle.hitv.com/ru.srt?sign=x');
    expect(captured[0]!.url).toBe('https://disp-glb.titan.mgtv.com/vod.do?pm=1&fid=2');

    const text = await downloadSubtitle(srtUrl);
    expect(text).toContain('Привет');
    expect(captured[1]!.url).toBe('https://subtitle.hitv.com/ru.srt?sign=x');
    // hitv.com is a different company domain — cookies must never go there
    expect(captured[1]!.headers.Cookie).toBeUndefined();
  });

  it('downloadSubtitle throws DownloadError on HTTP errors', async () => {
    global.fetch = mock(async () => new Response('gone', { status: 404 })) as unknown as typeof fetch;
    await expect(downloadSubtitle('https://subtitle.hitv.com/ru.srt')).rejects.toThrow(DownloadError);
  });

  it('fetchPlayerInfo throws CookieError when pm2 is missing (stale cookies)', async () => {
    stubFetch([JSON.stringify({ code: 200, data: { user: { login: true }, info: {} } })]);
    await expect(fetchPlayerInfo('24677071', 'sessionid=vip')).rejects.toThrow(CookieError);
    await expect(fetchPlayerInfo('24677071', 'sessionid=vip')).rejects.toThrow(/pm2 token/);
  });

  it('downloadSubtitle wraps network failures in DownloadError', async () => {
    global.fetch = mock(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(downloadSubtitle('https://subtitle.hitv.com/ru.srt')).rejects.toThrow(DownloadError);
  });

  it('resolveM3u8Url strips a leading arange param and sends no cookies', async () => {
    stubFetch(['jsonp_3_1({"info":"https://pcvideoaliyun.mgtv.com/lead.m3u8?mac=def"})']);

    const m3u8 = await resolveM3u8Url('https://disp-glb.titan.mgtv.com', '/atcl/y?arange=2&pm=1');
    expect(m3u8).toBe('https://pcvideoaliyun.mgtv.com/lead.m3u8?mac=def');
    expect(captured[0]!.url).toBe('https://disp-glb.titan.mgtv.com/atcl/y?pm=1');
    // resolve calls hit titan.mgtv.com unauthenticated — no cookies, signed URL only
    expect(captured[0]!.headers.Cookie).toBeUndefined();
  });
});
