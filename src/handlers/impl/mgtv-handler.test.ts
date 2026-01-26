import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { EpisodeType } from '../../types/episode.types';
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
});
