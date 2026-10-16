import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieError, DownloadError } from '../../errors/custom-errors.js';
import type { Episode } from '../../types/episode.types.js';
import { EpisodeType } from '../../types/episode-type';
import type { YoukuApi, YoukuUpsResult } from '../lib/youku-api.js';
import type { YtdlpDownloadResult, YtdlpWrapper } from '../lib/ytdlp-wrapper.js';
import { YoukuDownloader } from './youku-downloader';

function makeEpisode(): Episode {
  return {
    number: 8,
    url: 'https://www.youku.tv/v/v_show/id_XNjU3NzMxMTcxNg==.html',
    type: EpisodeType.VIP,
    extractedAt: new Date(),
  };
}

const UPS_OK: YoukuUpsResult = {
  title: 'Good Night 08',
  seconds: 2749.32,
  maxStreamLevel: 4,
  streams: [
    { stream_type: 'auto', width: 640, height: 360, drm_type: 'default', m3u8_url: '#EXTM3U inline text' },
    {
      stream_type: 'cmfv4hd',
      width: 864,
      height: 486,
      drm_type: 'default',
      m3u8_url: 'http://pl-ali.youku.tv/hd.m3u8?x=1',
    },
    {
      stream_type: 'cmfv4hd2',
      width: 1280,
      height: 720,
      drm_type: 'default',
      m3u8_url: 'http://pl-ali.youku.tv/hd2.m3u8?x=1',
    },
  ],
  subtitles: [
    { subtitle_lang: 'default', url: 'http://sub.ykimg.com/chs.ass' },
    { subtitle_lang: 'cht', url: 'http://sub.ykimg.com/cht.ass' },
    { subtitle_lang: 'en', url: 'http://sub.ykimg.com/en.ass' },
  ],
};

function makeApi(overrides: Partial<YoukuApi> = {}): YoukuApi {
  return {
    extractVideoId: mock((url: string) => url.match(/(XNj[A-Za-z0-9+/=]+)\.html/)?.[1] ?? null),
    readYoukuCookiePairs: mock(async () => ['cna=CNA-1', 'P_sck=S-1']),
    mintUps: mock(async () => UPS_OK),
    fetchSubtitle: mock(async () => 'SUBTITLE TEXT'),
    ...overrides,
  };
}

function makeWrapper(result: Partial<YtdlpDownloadResult> = {}): YtdlpWrapper {
  return {
    download: mock(
      async (): Promise<YtdlpDownloadResult> => ({
        filename: 'out/E08.mp4',
        allFiles: ['out/E08.mp4'],
        ...result,
      }),
    ),
  };
}

describe('YoukuDownloader', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'youku-dl-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('getName / supports', () => {
    it('reports name youku', () => {
      expect(new YoukuDownloader().getName()).toBe('youku');
    });

    it('supports youku.tv and subdomains', () => {
      const dl = new YoukuDownloader();
      expect(dl.supports('https://www.youku.tv/v/v_show/id_XNjU3NzMxMTcxNg==.html')).toBe(true);
      expect(dl.supports('https://v.youku.tv/v_show/id_XNjU3NzMxMTcxNg==.html')).toBe(true);
    });

    it('rejects other domains and invalid urls', () => {
      const dl = new YoukuDownloader();
      expect(dl.supports('https://wetv.vip/play/abc')).toBe(false);
      expect(dl.supports('not a url')).toBe(false);
    });
  });

  describe('download', () => {
    it('mints at download time and hands the best m3u8 to yt-dlp with referer, no cookies', async () => {
      const api = makeApi();
      const wrapper = makeWrapper();
      const logs: string[] = [];
      const dl = new YoukuDownloader(api, wrapper);

      const result = await dl.download(makeEpisode(), dir, 'E08', {
        cookieFile: undefined,
        onLog: (m) => logs.push(m),
      });

      expect(api.mintUps).toHaveBeenCalledWith('XNjU3NzMxMTcxNg==', []);
      expect(wrapper.download).toHaveBeenCalledTimes(1);
      expect(wrapper.download).toHaveBeenCalledWith('http://pl-ali.youku.tv/hd2.m3u8?x=1', 'E08', dir, {
        args: ['--referer', 'https://www.youku.tv/'],
        onProgress: undefined,
        onLog: expect.any(Function),
      });
      // best-overall == best-usable here: no degradation may be logged
      expect(logs.join('\n')).not.toMatch(/degrad|unlocked/i);
      expect(result).toEqual({ filename: 'out/E08.mp4', allFiles: ['out/E08.mp4'] });
    });

    it('loads domain-filtered cookies, logs only the count, and passes pairs to mintUps', async () => {
      const api = makeApi();
      const logs: string[] = [];
      const dl = new YoukuDownloader(api, makeWrapper());

      await dl.download(makeEpisode(), dir, 'E08', {
        cookieFile: join(dir, 'cookies.txt'),
        subLangs: [],
        onLog: (m) => logs.push(m),
      });

      expect(api.readYoukuCookiePairs).toHaveBeenCalledWith(join(dir, 'cookies.txt'));
      expect(api.mintUps).toHaveBeenCalledWith('XNjU3NzMxMTcxNg==', ['cna=CNA-1', 'P_sck=S-1']);
      expect(logs.join('\n')).toContain('loaded 2 youku cookies');
      // cookie VALUES never appear in logs
      expect(logs.join('\n')).not.toContain('CNA-1');
      expect(logs.join('\n')).not.toContain('S-1');
    });

    it('propagates CookieError from cookie loading', async () => {
      const api = makeApi({
        readYoukuCookiePairs: mock(async () => {
          throw new CookieError('No youku.tv/youku.com cookies in the cookie file');
        }),
      });
      const dl = new YoukuDownloader(api, makeWrapper());

      await expect(dl.download(makeEpisode(), dir, 'E08', { cookieFile: join(dir, 'cookies.txt') })).rejects.toThrow(
        CookieError,
      );
    });

    it('propagates the trial DownloadError from mintUps', async () => {
      const api = makeApi({
        mintUps: mock(async () => {
          throw new DownloadError(
            'Youku: not logged in or cookies expired — the server issued a 6-minute trial',
            'https://www.youku.tv/',
          );
        }),
      });
      const dl = new YoukuDownloader(api, makeWrapper());

      await expect(dl.download(makeEpisode(), dir, 'E08')).rejects.toThrow(/trial/);
    });

    it('falls back below an inline-text-only higher tier and logs the degradation', async () => {
      const api = makeApi({
        mintUps: mock(
          async (): Promise<YoukuUpsResult> => ({
            ...UPS_OK,
            streams: [
              { stream_type: 'auto', width: 1920, height: 1080, drm_type: 'default', m3u8_url: '#EXTM3U inline text' },
              { stream_type: 'cmfv4hd', width: 864, height: 486, drm_type: 'default', m3u8_url: 'http://x/hd.m3u8' },
            ],
          }),
        ),
      });
      const wrapper = makeWrapper();
      const logs: string[] = [];
      const dl = new YoukuDownloader(api, wrapper);

      await dl.download(makeEpisode(), dir, 'E08', { onLog: (m) => logs.push(m) });

      expect(wrapper.download).toHaveBeenCalledWith('http://x/hd.m3u8', 'E08', dir, expect.anything());
      expect(logs.join('\n')).toMatch(/486p|degrad|unlocked/i);
    });

    it('throws DownloadError when the URL has no video id', async () => {
      const dl = new YoukuDownloader(makeApi(), makeWrapper());
      const bad: Episode = { ...makeEpisode(), url: 'https://www.youku.tv/nowplaying' };
      await expect(dl.download(bad, dir, 'E08')).rejects.toThrow(/video ID/i);
    });

    it('downloads and writes matched subtitles as <name>.<tag>.ass (default → chs)', async () => {
      const api = makeApi();
      const dl = new YoukuDownloader(api, makeWrapper());

      const result = await dl.download(makeEpisode(), dir, 'E08', { subLangs: ['chs', 'en'] });

      expect(api.fetchSubtitle).toHaveBeenCalledTimes(2);
      const chs = await readFile(join(dir, 'E08.chs.ass'), 'utf-8');
      expect(chs).toBe('SUBTITLE TEXT');
      expect(result.allFiles).toContain(join(dir, 'E08.chs.ass'));
      expect(result.allFiles).toContain(join(dir, 'E08.en.ass'));
      expect(result.allFiles.some((f) => f.endsWith('E08.cht.ass'))).toBe(false);
    });

    it('keeps the video when one subtitle track fails and continues the rest', async () => {
      const api = makeApi({
        fetchSubtitle: mock(async (url: string) => {
          if (url.includes('chs')) throw new Error('HTTP 403');
          return 'EN TEXT';
        }),
      });
      const wrapper = makeWrapper();
      const logs: string[] = [];
      const dl = new YoukuDownloader(api, wrapper);

      const result = await dl.download(makeEpisode(), dir, 'E08', {
        subLangs: ['chs', 'en'],
        onLog: (m) => logs.push(m),
      });

      expect(result.filename).toBe('out/E08.mp4');
      expect(wrapper.download).toHaveBeenCalledTimes(1);
      expect(result.allFiles).toContain(join(dir, 'E08.en.ass'));
      expect(result.allFiles.some((f) => f.endsWith('E08.chs.ass'))).toBe(false);
      expect(logs.join('\n')).toContain('subtitle download failed');
    });

    it('keeps the video when every subtitle download fails', async () => {
      const api = makeApi({
        fetchSubtitle: mock(async () => {
          throw new Error('boom');
        }),
      });
      const logs: string[] = [];
      const dl = new YoukuDownloader(api, makeWrapper());

      const result = await dl.download(makeEpisode(), dir, 'E08', {
        subLangs: ['chs'],
        onLog: (m) => logs.push(m),
      });

      expect(result.filename).toBe('out/E08.mp4');
      expect(result.allFiles.some((f) => f.endsWith('.ass'))).toBe(false);
      expect(logs.join('\n')).toContain('subtitle download failed');
    });

    it('does not touch subtitles when subLangs is empty', async () => {
      const api = makeApi();
      const dl = new YoukuDownloader(api, makeWrapper());

      await dl.download(makeEpisode(), dir, 'E08', { subLangs: [] });

      expect(api.fetchSubtitle).not.toHaveBeenCalled();
    });
  });
});
