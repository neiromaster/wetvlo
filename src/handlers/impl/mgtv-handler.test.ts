import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { EpisodeType } from '../../types/episode-type';
import { MGTVHandler } from './mgtv-handler';

describe('MGTVHandler', () => {
  let handler: MGTVHandler;

  beforeEach(() => {
    handler = new MGTVHandler();
  });

  describe('getDomain', () => {
    it('should return mgtv.com', () => {
      expect(handler.getDomain()).toBe('mgtv.com');
    });
  });

  describe('supports', () => {
    it('should support mgtv.com', () => {
      expect(handler.supports('https://mgtv.com/b/823701/23967831.html')).toBe(true);
    });

    it('should support w.mgtv.com', () => {
      expect(handler.supports('https://w.mgtv.com/b/823701/23967831.html')).toBe(true);
    });

    it('should not support other domains', () => {
      expect(handler.supports('https://example.com/video')).toBe(false);
    });
  });

  describe('extractEpisodes', () => {
    it('should extract episodes from valid API response', async () => {
      const mockResponse = {
        code: 200,
        msg: '',
        data: {
          total_page: 1,
          current_page: 1,
          list: [
            {
              t1: '1',
              t2: 'EP 1',
              t4: '第1集',
              isvip: '0',
              url: '/b/823701/23967831.html',
              video_id: '23967831',
              clip_id: '823701',
              time: '45:00',
              ts: '2026-01-01',
            },
            {
              t1: '2',
              t2: 'EP 2',
              t4: '第2集',
              isvip: '1',
              url: '/b/823701/23967832.html',
              video_id: '23967832',
              clip_id: '823701',
              time: '45:00',
              ts: '2026-01-02',
            },
          ],
          info: {
            title: 'Glory',
            isvip: '0',
          },
        },
      };

      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(mockResponse)))) as any;

      const episodes = await handler.extractEpisodes('https://w.mgtv.com/b/823701/23967831.html');

      expect(episodes).toHaveLength(2);

      expect(episodes[0]?.number).toBe(1);
      expect(episodes[0]?.type).toBe(EpisodeType.AVAILABLE);
      expect(episodes[0]?.url).toBe('https://w.mgtv.com/b/823701/23967831.html');
      expect(episodes[0]?.title).toBe('EP 1');

      expect(episodes[1]?.number).toBe(2);
      expect(episodes[1]?.type).toBe(EpisodeType.VIP);
      expect(episodes[1]?.url).toBe('https://w.mgtv.com/b/823701/23967832.html');
      expect(episodes[1]?.title).toBe('EP 2');
    });

    it('should handle invalid URL gracefully', async () => {
      expect(handler.extractEpisodes('https://w.mgtv.com/invalid')).rejects.toThrow(
        'Could not extract video ID from URL',
      );
    });

    it('should handle API errors', async () => {
      const mockResponse = {
        code: 500,
        msg: 'Server Error',
        data: null,
      };

      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(mockResponse)))) as any;

      expect(handler.extractEpisodes('https://w.mgtv.com/b/823701/23967831.html')).rejects.toThrow(
        'MGTV API error: Server Error',
      );
    });

    it('should deduplicate episodes', async () => {
      const mockResponse = {
        code: 200,
        msg: '',
        data: {
          total_page: 1,
          current_page: 1,
          list: [
            {
              t1: '1',
              t2: 'EP 1',
              t4: '第1集',
              isvip: '0',
              url: '/b/823701/23967831.html',
              video_id: '23967831',
              clip_id: '823701',
              time: '45:00',
              ts: '2026-01-01',
            },
            {
              t1: '1', // Duplicate
              t2: 'EP 1',
              t4: '第1集',
              isvip: '0',
              url: '/b/823701/23967831.html',
              video_id: '23967831',
              clip_id: '823701',
              time: '45:00',
              ts: '2026-01-01',
            },
          ],
          info: {
            title: 'Glory',
            isvip: '0',
          },
        },
      };

      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(mockResponse)))) as any;

      const episodes = await handler.extractEpisodes('https://w.mgtv.com/b/823701/23967831.html');

      expect(episodes).toHaveLength(1);
      expect(episodes[0]?.number).toBe(1);
    });
  });

  describe('teaser detection (Preview EP N clips)', () => {
    type MgtvListItem = {
      t1: string;
      t2: string;
      t4: string;
      isvip: string;
      url: string;
      video_id: string;
      clip_id: string;
      time: string;
      ts: string;
      t3?: string;
      isIntact?: string;
      corner?: Array<{ area: string; flag: string; color: string; font: string }>;
    };

    const PRE_BADGE = { area: 'rightUp', flag: '2', color: '#0077FF', font: 'Pre' };

    function listItem(overrides: Partial<MgtvListItem>): MgtvListItem {
      return {
        t1: '1',
        t2: 'EP 1',
        t4: '第1集',
        isvip: '0',
        url: '/b/919355/24753475.html',
        video_id: '24753475',
        clip_id: '919355',
        time: '13:30',
        ts: '2026-10-29 21:08:59.0',
        ...overrides,
      };
    }

    function stubList(items: MgtvListItem[]): void {
      const mockResponse = {
        code: 200,
        msg: '',
        data: {
          total_page: 1,
          current_page: 1,
          list: items,
          info: { title: 'Glory', isvip: '0' },
        },
      };
      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(mockResponse)))) as any;
    }

    // Real payloads from the episode list API (2026-11-04, series 919355):
    // released episodes carry isIntact "1"; "Preview EP N" clips carry
    // isIntact "3", a {flag:"2", font:"Pre"} corner badge and ~45s duration,
    // and are listed BEFORE the full episode with the same number.

    it('marks Preview clips as teasers and keeps full episodes as before', async () => {
      stubList([
        listItem({}),
        listItem({
          t1: '7',
          t2: 'Preview EP 7',
          t3: 'Preview EP 7',
          url: '/b/919355/24754638.html',
          video_id: '24754638',
          time: '00:45',
          isIntact: '3',
          corner: [PRE_BADGE],
        }),
      ]);

      const episodes = await handler.extractEpisodes('https://w.mgtv.com/b/919355/24753475.html');

      expect(episodes).toHaveLength(2);
      expect(episodes[0]?.type).toBe(EpisodeType.AVAILABLE);
      expect(episodes[1]?.type).toBe(EpisodeType.TEASER);
      expect(episodes[1]?.title).toBe('Preview EP 7');
    });

    it('detects a teaser by the Pre corner badge when the title is plain', async () => {
      stubList([
        listItem({
          t1: '8',
          t2: 'EP 8',
          url: '/b/919355/24754639.html',
          video_id: '24754639',
          time: '00:40',
          isIntact: '3',
          corner: [PRE_BADGE],
        }),
      ]);

      const episodes = await handler.extractEpisodes('https://w.mgtv.com/b/919355/24753475.html');

      expect(episodes[0]?.type).toBe(EpisodeType.TEASER);
    });

    it('a full episode displaces its teaser listed earlier', async () => {
      stubList([
        listItem({}),
        listItem({
          t1: '3',
          t2: 'Preview EP 3',
          t3: 'Preview EP 3',
          url: '/b/919355/24754634.html',
          video_id: '24754634',
          time: '00:46',
          isIntact: '3',
          corner: [PRE_BADGE],
        }),
        listItem({
          t1: '3',
          t2: 'EP 3',
          isvip: '1',
          url: '/b/919355/24753477.html',
          video_id: '24753477',
          time: '13:06',
          isIntact: '1',
          corner: [
            { area: 'rightUp', flag: '1', color: '#E4B659', font: 'VIP' },
            { area: 'rightDown', flag: '5', color: '#FFFFFF', font: '第3集' },
          ],
        }),
      ]);

      const episodes = await handler.extractEpisodes('https://w.mgtv.com/b/919355/24753475.html');

      expect(episodes).toHaveLength(2);
      const ep3 = episodes[1];
      expect(ep3?.number).toBe(3);
      expect(ep3?.type).toBe(EpisodeType.VIP);
      expect(ep3?.url).toBe('https://w.mgtv.com/b/919355/24753477.html');
    });

    it('keeps teasers for slots where only a teaser exists', async () => {
      stubList([
        listItem({}),
        listItem({
          t1: '7',
          t2: 'Preview EP 7',
          url: '/b/919355/24754638.html',
          video_id: '24754638',
          time: '00:45',
          isIntact: '3',
          corner: [PRE_BADGE],
        }),
        listItem({
          t1: '8',
          t2: 'Preview EP 8',
          url: '/b/919355/24754639.html',
          video_id: '24754639',
          time: '00:40',
          isIntact: '3',
          corner: [PRE_BADGE],
        }),
      ]);

      const episodes = await handler.extractEpisodes('https://w.mgtv.com/b/919355/24753475.html');

      expect(episodes).toHaveLength(3);
      expect(episodes.map((ep) => ep.type)).toEqual([EpisodeType.AVAILABLE, EpisodeType.TEASER, EpisodeType.TEASER]);
    });
  });
});
