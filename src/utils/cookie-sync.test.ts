import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isJunkCookieDomain, sanitizeCookieFile } from './cookie-sync.js';

describe('isJunkCookieDomain', () => {
  it('marks host-prefixed dot-domains (.www.*) as junk', () => {
    expect(isJunkCookieDomain('.www.iq.com')).toBe(true);
    expect(isJunkCookieDomain('.www.firefox.com')).toBe(true);
    expect(isJunkCookieDomain('.www.base64decode.org')).toBe(true);
  });

  it('keeps legitimate domain cookies', () => {
    expect(isJunkCookieDomain('.iq.com')).toBe(false);
    expect(isJunkCookieDomain('.wetv.vip')).toBe(false);
    expect(isJunkCookieDomain('.mgtv.com')).toBe(false);
  });

  it('keeps host-only cookies whose host starts with www', () => {
    expect(isJunkCookieDomain('www.iq.com')).toBe(false);
    expect(isJunkCookieDomain('www.wetv.vip')).toBe(false);
  });

  it('keeps bare and empty domains', () => {
    expect(isJunkCookieDomain('iq.com')).toBe(false);
    expect(isJunkCookieDomain('')).toBe(false);
  });
});

describe('sanitizeCookieFile', () => {
  it('removes .www.* junk lines, keeps comments and legit cookies, returns removed count', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cookies-')), 'cookies.txt');
    writeFileSync(
      file,
      [
        '# Netscape HTTP Cookie File',
        '',
        '.iq.com\tTRUE\t/\tTRUE\t2147483647\tQC005\tabc',
        '.www.iq.com\tTRUE\t/\tTRUE\t0\t_gh_sess\txyz',
        'www.iq.com\tFALSE\t/\tTRUE\t2147483647\tlang\ten_us',
        '.www.iq.com\tTRUE\t/\tTRUE\t0\tspanner\t123',
      ].join('\n'),
    );

    const removed = await sanitizeCookieFile(file);

    expect(removed).toBe(2);
    const content = readFileSync(file, 'utf-8');
    expect(content).not.toContain('_gh_sess');
    expect(content).not.toContain('spanner');
    expect(content).toContain('QC005\tabc');
    expect(content).toContain('lang\ten_us');
    expect(content).toContain('# Netscape HTTP Cookie File');
  });

  it('is a no-op when the file has no junk (content untouched)', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cookies-')), 'cookies.txt');
    const original = ['# Netscape HTTP Cookie File', '.iq.com\tTRUE\t/\tTRUE\t2147483647\tQC005\tabc'].join('\n');
    writeFileSync(file, original);

    const removed = await sanitizeCookieFile(file);

    expect(removed).toBe(0);
    expect(readFileSync(file, 'utf-8')).toBe(original);
  });

  it('returns 0 for a missing file without throwing', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cookies-')), 'missing.txt');

    const removed = await sanitizeCookieFile(file);

    expect(removed).toBe(0);
    expect(existsSync(file)).toBe(false);
  });
});
