import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { EpisodeType } from '../../types/episode.types.js';
import { WeTVHandler } from './wetv-handler.js';

describe('WeTVHandler', () => {
  let handler: WeTVHandler;

  beforeEach(() => {
    handler = new WeTVHandler();
    // Reset fetch mock
    global.fetch = mock(() => Promise.resolve(new Response(''))) as any;
  });

  describe('getDomain', () => {
    it('should return wetv.vip', () => {
      expect(handler.getDomain()).toBe('wetv.vip');
    });
  });

  describe('extractEpisodes', () => {
    it('should extract episodes from valid HTML', async () => {
      const html = `
        <html>
          <body>
            <ul>
              <li>
                <a class="play-video__link" href="/play/123/EP1" aria-label="Play episode 01" title="Episode 1">
                  Episode 1
                </a>
              </li>
              <li>
                <span class="play-video__label">VIP</span>
                <a class="play-video__link" href="/play/123/EP2" aria-label="Play episode 02" title="Episode 2">
                  Episode 2
                </a>
              </li>
              <li>
                <a class="play-video__link" href="/play/123/EP3" aria-label="Play episode 03" title="Episode 3">
                  Episode 3
                </a>
                <span class="play-video__label">Teaser</span>
              </li>
            </ul>
          </body>
        </html>
      `;

      global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

      const episodes = await handler.extractEpisodes('https://wetv.vip/play/123');

      expect(episodes).toHaveLength(3);

      expect(episodes[0]?.number).toBe(1);
      expect(episodes[0]?.type).toBe(EpisodeType.AVAILABLE);
      expect(episodes[0]?.url).toBe('https://wetv.vip/play/123/EP1');

      expect(episodes[1]?.number).toBe(2);
      expect(episodes[1]?.type).toBe(EpisodeType.VIP);

      expect(episodes[2]?.number).toBe(3);
      expect(episodes[2]?.type).toBe(EpisodeType.TEASER);
    });

    it('should handle fallback selectors', async () => {
      const html = `
        <html>
          <body>
            <ul>
              <li>
                <a href="/play/123?id=EP1" aria-label="Play episode 1">
                  Episode 1
                </a>
              </li>
            </ul>
          </body>
        </html>
      `;

      global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

      const episodes = await handler.extractEpisodes('https://wetv.vip/play/123');

      expect(episodes).toHaveLength(1);
      expect(episodes[0]?.number).toBe(1);
    });

    it('should deduplicate episodes', async () => {
      const html = `
        <html>
          <body>
            <ul>
              <li><a class="play-video__link" href="/play/EP1" aria-label="Play episode 1">Ep 1</a></li>
              <li><a class="play-video__link" href="/play/EP1" aria-label="Play episode 1">Ep 1 Duplicate</a></li>
            </ul>
          </body>
        </html>
      `;

      global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

      const episodes = await handler.extractEpisodes('https://wetv.vip/play/123');

      expect(episodes).toHaveLength(1);
    });

    it('should sort episodes by number', async () => {
      const html = `
        <html>
          <body>
            <ul>
              <li><a class="play-video__link" href="/play/EP2" aria-label="Play episode 2">Ep 2</a></li>
              <li><a class="play-video__link" href="/play/EP1" aria-label="Play episode 1">Ep 1</a></li>
            </ul>
          </body>
        </html>
      `;

      global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

      const episodes = await handler.extractEpisodes('https://wetv.vip/play/123');

      expect(episodes[0]?.number).toBe(1);
      expect(episodes[1]?.number).toBe(2);
    });

    describe('extractFromNextData', () => {
      it('should extract all episodes including Express type', async () => {
        const pageData = {
          canPlay: true,
          coverInfo: {
            cid: 'test123',
            title: 'Test Series',
          },
          videoList: [
            {
              vid: 'abc123',
              episode: '01',
              isTrailer: false,
              payStatus: 8,
              coverList: ['test123'],
            },
            {
              vid: 'def456',
              episode: '02',
              isTrailer: false,
              payStatus: 6,
              coverList: ['test123'],
            },
            {
              vid: 'ghi789',
              episode: '03',
              isTrailer: false,
              payStatus: 12,
              labels: {
                '2': {
                  text: 'Express',
                  color: 'CB',
                },
              },
              coverList: ['test123'],
            },
            {
              vid: 'jkl012',
              episode: '04',
              isTrailer: true,
              payStatus: 8,
            },
          ],
        };

        // Build the complete NextData structure
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

        const episodes = await handler.extractEpisodes('https://wetv.vip/play/test');

        expect(episodes).toHaveLength(3); // Excludes trailer

        expect(episodes[0]?.number).toBe(1);
        expect(episodes[0]?.type).toBe(EpisodeType.AVAILABLE);

        expect(episodes[1]?.number).toBe(2);
        expect(episodes[1]?.type).toBe(EpisodeType.VIP);

        expect(episodes[2]?.number).toBe(3);
        expect(episodes[2]?.type).toBe(EpisodeType.EXPRESS);
      });

      it('should skip trailers when extracting from next data', async () => {
        const pageData = {
          canPlay: true,
          coverInfo: {
            cid: 'test123',
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
              isTrailer: true,
              payStatus: 8,
            },
          ],
        };

        // Build the complete NextData structure
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

        const episodes = await handler.extractEpisodes('https://wetv.vip/play/test');

        expect(episodes).toHaveLength(1); // Only non-trailer
        expect(episodes[0]?.number).toBe(1);
      });

      it('should handle empty video list', async () => {
        const pageData = {
          canPlay: true,
          coverInfo: {
            cid: 'test123',
            title: 'Test Series',
          },
          videoList: [],
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

        const episodes = await handler.extractEpisodes('https://wetv.vip/play/test');

        expect(episodes).toHaveLength(0);
      });

      it('should fall back to HTML parsing when __NEXT_DATA__ is invalid', async () => {
        const html = `
          <html>
            <body>
              <script id="__NEXT_DATA__" type="application/json">invalid json</script>
              <ul>
                <li>
                  <a class="play-video__link" href="/play/123/EP1" aria-label="Play episode 01">
                    Episode 1
                  </a>
                </li>
              </ul>
            </body>
          </html>
        `;

        global.fetch = mock(() => Promise.resolve(new Response(html))) as any;

        const episodes = await handler.extractEpisodes('https://wetv.vip/play/123');

        expect(episodes).toHaveLength(1);
        expect(episodes[0]?.number).toBe(1);
      });
    });
  });
});
