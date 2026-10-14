import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieError, DownloadError } from '../../errors/custom-errors.js';
import { extractVideoId, makeTk2, mgtvFetchJson, readMgtvCookieHeader } from './mgtv-api';

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
  // Netscape format: domain \t flag \t path \t secure \t expiry \t name \t value
  const NETSCAPE = [
    '# Netscape HTTP Cookie File',
    '# This is a generated file! Do not edit.',
    '',
    '.openai.com\tTRUE\t/\tTRUE\t0\t__Secure-next-auth.session-token\tSECRET-MUST-NOT-LEAK',
    '.alipay.com\tTRUE\t/\tTRUE\t1780000000\tcna\tALIPAY-SECRET',
    '.mgtv.com\tTRUE\t/\tTRUE\t1790000000\tPHPSESSID\tabc123',
    'w.mgtv.com\tFALSE\t/\tTRUE\t1790000000\tsessionid\tvip-session-42',
    '.mgtv.com\tTRUE\t/\tTRUE\t1790000000\tPHPSESSID\tduplicate-domain-skipped',
    'evil-mgtv.com.attacker.com\tTRUE\t/\tTRUE\t1790000000\tspoof\tMUST-NOT-LEAK',
    'short-line',
  ].join('\n');

  it('keeps only mgtv.com cookies and dedupes by name+domain', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mgtv-cookie-test-'));
    const file = join(dir, 'cookies.txt');
    await writeFile(file, NETSCAPE, 'utf-8');

    const header = await readMgtvCookieHeader(file);

    expect(header).toBe('PHPSESSID=abc123; sessionid=vip-session-42');
    expect(header).not.toContain('SECRET-MUST-NOT-LEAK');
    expect(header).not.toContain('ALIPAY-SECRET');
    expect(header).not.toContain('MUST-NOT-LEAK');
  });

  it('throws CookieError when the file has no mgtv.com cookies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mgtv-cookie-test-'));
    const file = join(dir, 'cookies.txt');
    await writeFile(file, '.example.com\tTRUE\t/\tTRUE\t0\tfoo\tbar', 'utf-8');

    await expect(readMgtvCookieHeader(file)).rejects.toThrow(CookieError);
  });

  it('throws CookieError when the file does not exist', async () => {
    await expect(readMgtvCookieHeader('Z:/definitely/not/here.txt')).rejects.toThrow(CookieError);
  });

  it('parses #HttpOnly_ cookies and handles CRLF line endings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mgtv-cookie-test-'));
    const file = join(dir, 'cookies.txt');
    // \r\n line endings are what Windows exports produce
    await writeFile(
      file,
      [
        '#HttpOnly_.mgtv.com\tTRUE\t/\tTRUE\t1790000000\tsessionid\thttponly-session',
        '.openai.com\tTRUE\t/\tTRUE\t0\tk\tv',
      ].join('\r\n'),
      'utf-8',
    );

    const header = await readMgtvCookieHeader(file);
    expect(header).toBe('sessionid=httponly-session');
  });
});

describe('mgtvFetchJson', () => {
  const originalFetch = global.fetch;
  let capturedUrl: string | undefined;
  let capturedHeaders: Record<string, string>;

  beforeEach(() => {
    capturedUrl = undefined;
    capturedHeaders = {};
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function stubFetch(body: string, status = 200) {
    global.fetch = mock(async (input: any, init?: any) => {
      capturedUrl = String(input);
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
