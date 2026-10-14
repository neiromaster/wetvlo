import { describe, expect, it } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCookieFile, readCookieHeaderForUrl } from './cookie-extractor.js';

describe('Cookie Extractor', () => {
  const tempFile = join(tmpdir(), `test-cookies-${Date.now()}.txt`);

  const cleanup = () => {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  };

  describe('readCookieFile', () => {
    it('should parse Netscape cookie file correctly', async () => {
      const content = [
        '# Netscape HTTP Cookie File',
        '# http://curl.haxx.se/rfc/cookie_spec.html',
        '# This is a generated file!  Do not edit.',
        '',
        'example.com\tTRUE\t/\tFALSE\t2147483647\tSessionId\t12345',
        '.google.com\tTRUE\t/\tTRUE\t2147483647\tNID\t67890',
      ].join('\n');

      writeFileSync(tempFile, content);

      try {
        const cookies = await readCookieFile(tempFile);
        expect(cookies).toContain('SessionId=12345');
        expect(cookies).toContain('NID=67890');
      } finally {
        cleanup();
      }
    });

    it('should throw error if file does not exist', async () => {
      expect(readCookieFile('/non/existent/file.txt')).rejects.toThrow('Cookie file not found');
    });

    it('should ignore comments and empty lines', async () => {
      const content = ['# Comment', '', 'example.com\tTRUE\t/\tFALSE\t2147483647\tCookieName\tCookieValue'].join('\n');

      writeFileSync(tempFile, content);

      try {
        const cookies = await readCookieFile(tempFile);
        expect(cookies).toBe('CookieName=CookieValue');
      } finally {
        cleanup();
      }
    });
  });

  describe('readCookieHeaderForUrl', () => {
    const writeFile = (name: string, content: string): string => {
      const path = join(tmpdir(), `${name}-${Date.now()}.txt`);
      writeFileSync(path, content);
      return path;
    };

    const cleanupFile = (path: string) => {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    };

    it('should return only cookies matching the URL host domain', async () => {
      const path = writeFile(
        'scoped-cookies-multi',
        [
          '# Netscape HTTP Cookie File',
          '',
          '.mgtv.com\tTRUE\t/\tTRUE\t2147483647\tPHPSESSID\tabc123',
          'openai.com\tTRUE\t/\tTRUE\t2147483647\topenai_sid\toai456',
          'alipay.com\tTRUE\t/\tFALSE\t2147483647\talipay_uuid\tzzz789',
        ].join('\n'),
      );

      try {
        const header = await readCookieHeaderForUrl(path, 'https://w.mgtv.com/b/1/2.html');
        expect(header).toBe('PHPSESSID=abc123');
        expect(header).not.toContain('openai_sid');
        expect(header).not.toContain('alipay_uuid');
      } finally {
        cleanupFile(path);
      }
    });

    it('should include #HttpOnly_ lines instead of skipping them', async () => {
      const path = writeFile(
        'scoped-cookies-httponly',
        [
          '#HttpOnly_.mgtv.com\tTRUE\t/\tTRUE\t2147483647\t__HC\tvalue1',
          '.mgtv.com\tTRUE\t/\tFALSE\t2147483647\tvisid\tvalue2',
        ].join('\n'),
      );

      try {
        const header = await readCookieHeaderForUrl(path, 'https://w.mgtv.com/b/1/2.html');
        expect(header).toBe('__HC=value1; visid=value2');
      } finally {
        cleanupFile(path);
      }
    });

    it('should match a bare domain (no leading dot) against subdomains', async () => {
      const path = writeFile('scoped-cookies-bare', 'mgtv.com\tTRUE\t/\tFALSE\t2147483647\tBARE\tyes');

      try {
        const header = await readCookieHeaderForUrl(path, 'https://w.mgtv.com/b/1/2.html');
        expect(header).toBe('BARE=yes');
      } finally {
        cleanupFile(path);
      }
    });

    it('should match a leading-dot domain against subdomains', async () => {
      const path = writeFile('scoped-cookies-dot', '.mgtv.com\tTRUE\t/\tFALSE\t2147483647\tDOT\tyes');

      try {
        const header = await readCookieHeaderForUrl(path, 'https://w.mgtv.com/b/1/2.html');
        expect(header).toBe('DOT=yes');
      } finally {
        cleanupFile(path);
      }
    });

    it('should return an empty string when no cookies match the domain', async () => {
      const path = writeFile('scoped-cookies-other', 'openai.com\tTRUE\t/\tTRUE\t2147483647\topenai_sid\toai456');

      try {
        const header = await readCookieHeaderForUrl(path, 'https://w.mgtv.com/b/1/2.html');
        expect(header).toBe('');
      } finally {
        cleanupFile(path);
      }
    });

    it('should throw CookieError when the file is missing', async () => {
      await expect(
        readCookieHeaderForUrl('/non/existent/cookies.txt', 'https://w.mgtv.com/b/1/2.html'),
      ).rejects.toThrow('Cannot read cookie file');
    });
  });
});
