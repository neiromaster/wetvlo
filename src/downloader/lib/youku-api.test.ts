import { describe, expect, it } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieError } from '../../errors/custom-errors.js';
import { mtopSign, readYoukuCookiePairs } from './youku-api';

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

    expect(pairs).toEqual(['cna=CNA-DEVICE-ID', 'csrfToken=csrf-42', 'P_F=f-token']);
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
