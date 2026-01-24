import { describe, expect, it } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCookieFile } from './cookie-extractor.js';

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
});
