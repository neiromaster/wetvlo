import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EpisodeType } from '../../types/episode-type';
import { YoukuHandler } from './youku-handler';

describe('YoukuHandler', () => {
  let handler: YoukuHandler;
  let fixtureHtml: string;
  const EP_URL = 'https://www.youku.tv/v/v_show/id_XNjU3NzMxMTcxNg==.html';

  beforeEach(async () => {
    handler = new YoukuHandler();
    fixtureHtml = await readFile(join(import.meta.dir, 'fixtures', 'youku-ep-page.html'), 'utf-8');
  });

  function stubPage(html: string, capture?: { cookie?: string }) {
    global.fetch = mock(async (_input: any, init?: any) => {
      if (capture) capture.cookie = (init?.headers as Record<string, string>)?.Cookie;
      return new Response(html, { status: 200 });
    }) as any;
  }

  describe('getDomain / supports', () => {
    it('returns youku.tv', () => {
      expect(handler.getDomain()).toBe('youku.tv');
    });

    it('supports youku.tv and subdomains, rejects others', () => {
      expect(handler.supports('https://www.youku.tv/v/v_show/id_XNjU3NzMxMTcxNg==.html')).toBe(true);
      expect(handler.supports('https://youku.tv/v/v_show/id_XNjU3NzMxMTcxNg==.html')).toBe(true);
      expect(handler.supports('https://wetv.vip/play/abc')).toBe(false);
    });
  });

  describe('extractEpisodes', () => {
    it('parses the live SSR page into 10 numbered episodes with correct types', async () => {
      stubPage(fixtureHtml);

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes).toHaveLength(10);
      expect(episodes.map((e) => e?.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      // marks in the fixture: EP1-3 free, EP4-8 VIP, EP9-10 Express
      expect(episodes[0]?.type).toBe(EpisodeType.AVAILABLE);
      expect(episodes[2]?.type).toBe(EpisodeType.AVAILABLE);
      expect(episodes[3]?.type).toBe(EpisodeType.VIP);
      expect(episodes[7]?.type).toBe(EpisodeType.VIP);
      expect(episodes[8]?.type).toBe(EpisodeType.EXPRESS);
      expect(episodes[9]?.type).toBe(EpisodeType.EXPRESS);

      // numbering comes from `stage`, not list position (Trailers sit at 11/12 with stage 9/10)
      expect(episodes[7]?.url).toBe(EP_URL);
      expect(episodes[7]?.title).toBe('Good Night 08');
      expect(episodes[0]?.title).toBe('Good Night 01');

      // trailers are skipped entirely
      expect(episodes.some((e) => (e?.title ?? '').includes('Trailer'))).toBe(false);
    });

    it('dedupes when the anthology blob appears twice', async () => {
      stubPage(fixtureHtml + fixtureHtml);

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes).toHaveLength(10);
    });

    it('returns [] when the anthology blob is missing (structural change)', async () => {
      stubPage('<html><body>unexpected structure</body></html>');

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes).toEqual([]);
    });

    it('passes cookies to the page fetch', async () => {
      const capture: { cookie?: string } = {};
      stubPage(fixtureHtml, capture);

      await handler.extractEpisodes(EP_URL, 'cna=x; P_sck=y');

      expect(capture.cookie).toBe('cna=x; P_sck=y');
    });
  });
});
