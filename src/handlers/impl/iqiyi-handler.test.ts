import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { EpisodeType } from '../../types/episode.types.js';
import { IQiyiHandler } from './iqiyi-handler.js';

describe('IQiyiHandler', () => {
  let handler: IQiyiHandler;

  beforeEach(() => {
    handler = new IQiyiHandler();
    // Reset fetch mock
    global.fetch = mock(() => Promise.resolve(new Response(''))) as any;
  });

  describe('getDomain', () => {
    it('should return iq.com', () => {
      expect(handler.getDomain()).toBe('iq.com');
    });
  });

  describe('extractEpisodes', () => {
    it('should extract episodes from album-episode-item', async () => {
      const html = `
        <html>
          <body>
            <div class="album-episode-item">
              <a href="/play/ep1" title="Episode 1">
                <div>Episode 1</div>
              </a>
            </div>
            <div class="album-episode-item">
              <div class="vip">VIP</div>
              <a href="/play/ep2" title="Episode 2">
                <div>Episode 2</div>
              </a>
            </div>
          </body>
        </html>
      `;

      global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

      const episodes = await handler.extractEpisodes('https://www.iq.com/play/123');

      expect(episodes).toHaveLength(2);

      expect(episodes[0]?.number).toBe(1);
      expect(episodes[0]?.type).toBe(EpisodeType.AVAILABLE);
      expect(episodes[0]?.url).toBe('https://www.iq.com/play/ep1');

      expect(episodes[1]?.number).toBe(2);
      expect(episodes[1]?.type).toBe(EpisodeType.VIP);
    });

    it('should extract episodes from intl-play-item', async () => {
      const html = `
        <html>
          <body>
            <div class="intl-play-item">
              <a href="/play/ep1">EP 01</a>
            </div>
          </body>
        </html>
      `;

      global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

      const episodes = await handler.extractEpisodes('https://www.iq.com/play/123');

      expect(episodes).toHaveLength(1);
      expect(episodes[0]?.number).toBe(1);
    });

    it('should extract episodes from data-episode', async () => {
      const html = `
        <html>
          <body>
            <div data-episode="1">
              <a href="/play/ep1">Episode 1</a>
            </div>
          </body>
        </html>
      `;

      global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

      const episodes = await handler.extractEpisodes('https://www.iq.com/play/123');

      expect(episodes).toHaveLength(1);
      expect(episodes[0]?.number).toBe(1);
    });

    it('should deduplicate episodes', async () => {
      const html = `
        <html>
          <body>
            <div class="album-episode-item">
              <a href="/play/ep1">Episode 1</a>
            </div>
            <div class="album-episode-item">
              <a href="/play/ep1">Episode 1 Duplicate</a>
            </div>
          </body>
        </html>
      `;

      global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

      const episodes = await handler.extractEpisodes('https://www.iq.com/play/123');

      expect(episodes).toHaveLength(1);
    });

    it('should filter out BTS episodes', async () => {
      const html = `
        <html>
          <body>
            <ul>
              <li><a href="/play/ep1">Episode 1</a></li>
              <li><a href="/play/ep2">BTS1</a></li>
              <li><a href="/play/ep3">Episode 2</a></li>
              <li><a href="/play/ep4">BTS2 Behind The Scenes</a></li>
            </ul>
          </body>
        </html>
      `;

      global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

      const episodes = await handler.extractEpisodes('https://www.iq.com/play/123');

      expect(episodes).toHaveLength(2);
      expect(episodes[0]?.number).toBe(1);
      expect(episodes[1]?.number).toBe(2);
    });

    describe('extractFromNextData', () => {
      it('should extract all episodes from __NEXT_DATA__', async () => {
        const pageData = {
          albumInfo: {
            albumId: 'test123',
            title: 'Test Series',
          },
          videoList: [
            {
              vid: 'abc123',
              episode: '01',
              isTrailer: false,
              payStatus: 8,
            },
            {
              vid: 'def456',
              episode: '02',
              isTrailer: false,
              payStatus: 6,
            },
            {
              vid: 'ghi789',
              episode: '03',
              isTrailer: true,
              payStatus: 8,
            },
          ],
        };

        const nextData = {
          props: {
            pageProps: {
              data: JSON.stringify(pageData),
            },
          },
        };

        const html = `
          <html>
            <body>
              <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
            </body>
          </html>
        `;

        global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

        const episodes = await handler.extractEpisodes('https://www.iq.com/play/test');

        expect(episodes).toHaveLength(2); // Excludes trailer

        expect(episodes[0]?.number).toBe(1);
        expect(episodes[0]?.type).toBe(EpisodeType.AVAILABLE);

        expect(episodes[1]?.number).toBe(2);
        expect(episodes[1]?.type).toBe(EpisodeType.VIP);
      });

      it('should extract episodes with new JSON structure and identify previews', async () => {
        const pageData = {
          albumInfo: {
            albumId: 'test123',
            title: 'Test Series',
          },
          videoList: [
            {
              vid: 'abc123',
              order: 1,
              subTitle: 'Episode 1',
              isTrailer: false,
              payMark: '',
              episodeType: 0,
            },
            {
              vid: 'def456',
              order: 2,
              subTitle: 'Episode 2',
              isTrailer: false,
              payMark: 'VIP_MARK',
              episodeType: 0,
            },
            {
              vid: 'ghi789',
              order: 3,
              subTitle: 'Episode 3 Preview',
              isTrailer: false,
              payMark: 'preview',
              episodeType: 1,
            },
          ],
        };

        const nextData = {
          props: {
            pageProps: {
              data: JSON.stringify(pageData),
            },
          },
        };

        const html = `
          <html>
            <body>
              <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
            </body>
          </html>
        `;

        global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

        const episodes = await handler.extractEpisodes('https://www.iq.com/play/test');

        expect(episodes).toHaveLength(3);

        expect(episodes[0]?.number).toBe(1);
        expect(episodes[0]?.type).toBe(EpisodeType.AVAILABLE);

        expect(episodes[1]?.number).toBe(2);
        expect(episodes[1]?.type).toBe(EpisodeType.VIP);

        expect(episodes[2]?.number).toBe(3);
        expect(episodes[2]?.type).toBe(EpisodeType.PREVIEW);
      });

      it('should fall back to HTML parsing when __NEXT_DATA__ is invalid', async () => {
        const html = `
          <html>
            <body>
              <script id="__NEXT_DATA__" type="application/json">invalid json</script>
              <ul>
                <li>
                  <a href="/play/ep1">Episode 1</a>
                </li>
              </ul>
            </body>
          </html>
        `;

        global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

        const episodes = await handler.extractEpisodes('https://www.iq.com/play/test');

        expect(episodes).toHaveLength(1);
        expect(episodes[0]?.number).toBe(1);
      });
    });
  });
});
