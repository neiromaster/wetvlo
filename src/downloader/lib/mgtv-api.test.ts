import { describe, expect, it } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieError } from '../../errors/custom-errors.js';
import { extractVideoId, makeTk2, readMgtvCookieHeader } from './mgtv-api';

describe('makeTk2', () => {
  it('produces the golden-vector signature for a fixed did and clit', () => {
    // Verified against the live MGTV player (2026-10-14)
    expect(makeTk2('00000000-0000-4000-8000-000000000000', 1700000000)).toBe(
      'wADMwADMwAzNx0Ddpx2Y8FDMzAjLz4CM9IXZ2xHMzATM98mbwxHMwADMwADMwADMwATLwADM40CMwADNtADMwATLwADMwADMwATPklGZ',
    );
  });

  it('defaults clit to current unix time when omitted', () => {
    const tk2 = makeTk2('11111111-1111-4111-8111-111111111111');
    expect(typeof tk2).toBe('string');
    expect(tk2.length).toBeGreaterThan(0);
    // reversed URL-safe base64 never contains raw '+', '/', '='
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
  });

  it('throws CookieError when the file has no mgtv.com cookies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mgtv-cookie-test-'));
    const file = join(dir, 'cookies.txt');
    await writeFile(file, '.example.com\tTRUE\t/\tTRUE\t0\tfoo\tbar', 'utf-8');

    expect(readMgtvCookieHeader(file)).rejects.toThrow(CookieError);
  });

  it('throws CookieError when the file does not exist', async () => {
    expect(readMgtvCookieHeader('Z:/definitely/not/here.txt')).rejects.toThrow(CookieError);
  });
});
