import { describe, expect, it } from 'bun:test';
import { extractDomain, isValidUrl, normalizeUrl } from './url-utils.js';

describe('URL Utils', () => {
  describe('extractDomain', () => {
    it('should extract domain from valid URL', () => {
      expect(extractDomain('https://wetv.vip/play/123')).toBe('wetv.vip');
      expect(extractDomain('http://www.iq.com/play/123')).toBe('www.iq.com');
    });

    it('should throw error for invalid URL', () => {
      expect(() => extractDomain('invalid-url')).toThrow('Invalid URL: "invalid-url"');
    });
  });

  describe('isValidUrl', () => {
    it('should return true for valid URL', () => {
      expect(isValidUrl('https://google.com')).toBe(true);
      expect(isValidUrl('ftp://example.com/file')).toBe(true);
    });

    it('should return false for invalid URL', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('/relative/path')).toBe(false);
    });
  });

  describe('normalizeUrl', () => {
    it('should remove trailing slash', () => {
      expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    it('should remove hash fragment', () => {
      expect(normalizeUrl('https://example.com/path#fragment')).toBe('https://example.com/path');
    });

    it('should handle both trailing slash and hash', () => {
      expect(normalizeUrl('https://example.com/path/#fragment')).toBe('https://example.com/path');
    });

    it('should return original string if invalid URL', () => {
      expect(normalizeUrl('not-a-url')).toBe('not-a-url');
    });
  });
});
