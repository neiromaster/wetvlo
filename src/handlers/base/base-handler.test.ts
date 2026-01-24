import { describe, expect, it, mock } from 'bun:test';
import type { Episode } from '../../types/episode.types.js';
import { BaseHandler } from './base-handler.js';

// Concrete implementation for testing abstract class
class TestHandler extends BaseHandler {
  getDomain(): string {
    return 'example.com';
  }

  async extractEpisodes(_url: string, _cookies?: string): Promise<Episode[]> {
    return [];
  }

  // Expose protected methods for testing
  public testParseEpisodeNumber(text: string): number | null {
    return this.parseEpisodeNumber(text);
  }

  public async testFetchHtml(url: string, cookies?: string): Promise<string> {
    return this.fetchHtml(url, cookies);
  }
}

describe('BaseHandler', () => {
  const handler = new TestHandler();

  describe('supports', () => {
    it('should support exact domain match', () => {
      expect(handler.supports('https://example.com/video/123')).toBe(true);
    });

    it('should support subdomain match', () => {
      expect(handler.supports('https://sub.example.com/video/123')).toBe(true);
    });

    it('should not support other domains', () => {
      expect(handler.supports('https://other.com/video/123')).toBe(false);
    });

    it('should handle invalid URLs gracefully', () => {
      expect(handler.supports('not-a-url')).toBe(false);
    });
  });

  describe('parseEpisodeNumber', () => {
    it('should parse Chinese format', () => {
      expect(handler.testParseEpisodeNumber('Title 第10集')).toBe(10);
    });

    it('should parse EP prefix', () => {
      expect(handler.testParseEpisodeNumber('Title EP05')).toBe(5);
      expect(handler.testParseEpisodeNumber('Title ep 5')).toBe(5);
    });

    it('should parse Episode prefix', () => {
      expect(handler.testParseEpisodeNumber('Title Episode 12')).toBe(12);
      expect(handler.testParseEpisodeNumber('Title E12')).toBe(12);
    });

    it('should parse standalone number', () => {
      expect(handler.testParseEpisodeNumber('15')).toBe(15);
    });

    it('should return null for no number', () => {
      expect(handler.testParseEpisodeNumber('Title No Number')).toBe(null);
    });
  });

  describe('fetchHtml', () => {
    it('should fetch HTML content', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response('<html><body>Content</body></html>')));
      global.fetch = mockFetch as any;

      const content = await handler.testFetchHtml('https://example.com');
      expect(content).toBe('<html><body>Content</body></html>');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should include cookies in request headers', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response('ok')));
      global.fetch = mockFetch as any;

      await handler.testFetchHtml('https://example.com', 'key=value');

      const calls = mockFetch.mock.calls;
      expect(calls.length).toBe(1);
      // @ts-expect-error
      const options = calls[0][1] as RequestInit;
      // @ts-expect-error
      expect(options.headers.Cookie).toBe('key=value');
    });

    it('should throw HandlerError on 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response('Not Found', { status: 404, statusText: 'Not Found' })),
      ) as any;

      expect(handler.testFetchHtml('https://example.com')).rejects.toThrow('HTTP 404: Not Found');
    });
  });
});
