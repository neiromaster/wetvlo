import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieError } from '../../errors/custom-errors.js';
import type { Episode } from '../../types/episode.types.js';
import { EpisodeType } from '../../types/episode-type';
import type { MgtvApi, MgtvSubtitleEntry } from '../lib/mgtv-api.js';
import type { YtdlpDownloadResult, YtdlpWrapper } from '../lib/ytdlp-wrapper.js';
import { MgtvDownloader } from './mgtv-downloader';

function makeEpisode(): Episode {
  return {
    number: 10,
    url: 'https://w.mgtv.com/b/908834/24677071.html',
    type: EpisodeType.VIP,
    extractedAt: new Date(),
  };
}

const STREAMS = [
  { name: '480P', filebitrate: '445', vip: '0', url: '/atcl/480' },
  { name: '1080P SDR', filebitrate: '1541', vip: '1', url: '/atcl/1080' },
];

function makeApi(overrides: Partial<MgtvApi> = {}): MgtvApi {
  return {
    fetchPlayerInfo: mock(async () => ({ pm2: 'pm2', login: true, isvip: true, title: 'EP10' })),
    fetchSourceStreams: mock(async () => ({ streamDomain: 'https://disp-glb.titan.mgtv.com', streams: STREAMS })),
    resolveM3u8Url: mock(async () => 'https://pcvideo.mgtv.com/playlist.m3u8?signed=1'),
    fetchSubtitleList: mock(async () => [] as MgtvSubtitleEntry[]),
    resolveSubtitleUrl: mock(async () => 'https://subtitle.hitv.com/x.srt'),
    downloadSubtitle: mock(async () => '1\n00:00:01,000 --> 00:00:02,000\nhi\n'),
    ...overrides,
  };
}

function makeWrapper(result: Partial<YtdlpDownloadResult> = {}): YtdlpWrapper {
  return {
    download: mock(
      async (): Promise<YtdlpDownloadResult> => ({
        filename: 'out/E10.mp4',
        allFiles: ['out/E10.mp4'],
        ...result,
      }),
    ),
  };
}

describe('MgtvDownloader', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mgtv-dl-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('getName / supports', () => {
    it('reports name mgtv', () => {
      expect(new MgtvDownloader().getName()).toBe('mgtv');
    });

    it('supports mgtv.com and subdomains', () => {
      const dl = new MgtvDownloader();
      expect(dl.supports('https://w.mgtv.com/b/908834/24677071.html')).toBe(true);
      expect(dl.supports('https://mgtv.com/b/823701/23967831.html')).toBe(true);
    });

    it('rejects other domains and invalid urls', () => {
      const dl = new MgtvDownloader();
      expect(dl.supports('https://wetv.vip/play/abc')).toBe(false);
      expect(dl.supports('not a url')).toBe(false);
    });
  });

  describe('download', () => {
    it('resolves the chain and calls yt-dlp with the signed m3u8 and referer', async () => {
      const api = makeApi();
      const wrapper = makeWrapper();
      const dl = new MgtvDownloader(api, wrapper);

      const result = await dl.download(makeEpisode(), dir, 'E10', { cookieFile: undefined });

      expect(api.fetchPlayerInfo).toHaveBeenCalledWith('24677071', undefined);
      expect(api.fetchSourceStreams).toHaveBeenCalledWith('24677071', 'pm2', undefined);
      expect(api.resolveM3u8Url).toHaveBeenCalledWith('https://disp-glb.titan.mgtv.com', '/atcl/1080');
      expect(wrapper.download).toHaveBeenCalledWith('https://pcvideo.mgtv.com/playlist.m3u8?signed=1', 'E10', dir, {
        args: ['--referer', 'https://w.mgtv.com/'],
        onProgress: undefined,
        onLog: undefined,
      });
      expect(result).toEqual({ filename: 'out/E10.mp4', allFiles: ['out/E10.mp4'] });
    });

    it('passes domain-filtered cookies to every API call and never leaks other domains', async () => {
      const cookieFile = join(dir, 'cookies.txt');
      await writeFile(
        cookieFile,
        [
          '.mgtv.com\tTRUE\t/\tFALSE\t1900000000\ta\t1',
          'foo.mgtv.com\tTRUE\t/\tFALSE\t1900000000\tb\t2',
          'openai.com\tTRUE\t/\tFALSE\t1900000000\tsecret\tMUST-NOT-LEAK',
          '',
        ].join('\n'),
      );
      const api = makeApi();
      const logs: string[] = [];
      const dl = new MgtvDownloader(api, makeWrapper());

      await dl.download(makeEpisode(), dir, 'E10', {
        cookieFile,
        subLangs: ['ru.*'],
        onLog: (m) => logs.push(m),
      });

      expect(api.fetchPlayerInfo).toHaveBeenCalledWith('24677071', 'a=1; b=2');
      expect(api.fetchSourceStreams).toHaveBeenCalledWith('24677071', 'pm2', 'a=1; b=2');
      expect(api.fetchSubtitleList).toHaveBeenCalledWith('24677071', 'a=1; b=2');
      expect(logs.join('\n')).toMatch(/loaded 2 mgtv\.com cookies/);
      expect(logs.join('\n')).not.toContain('MUST-NOT-LEAK');
    });

    it('throws CookieError when the cookie file is missing', async () => {
      const dl = new MgtvDownloader(makeApi(), makeWrapper());

      await expect(dl.download(makeEpisode(), dir, 'E10', { cookieFile: join(dir, 'missing.txt') })).rejects.toThrow(
        CookieError,
      );
    });

    it('falls back to the best unlocked stream and logs the degradation', async () => {
      const api = makeApi({
        fetchSourceStreams: mock(async () => ({
          streamDomain: 'https://disp-glb.titan.mgtv.com',
          streams: [
            { name: '1080P', filebitrate: '1541', vip: '1', url: '' },
            { name: '720P', filebitrate: '757', vip: '0', url: '/atcl/720' },
          ],
        })),
      });
      const wrapper = makeWrapper();
      const logs: string[] = [];
      const dl = new MgtvDownloader(api, wrapper);

      await dl.download(makeEpisode(), dir, 'E10', { onLog: (m) => logs.push(m) });

      expect(logs.join('\n')).toContain('falling back to 720P');
      expect(wrapper.download).toHaveBeenCalledTimes(1);
    });

    it('downloads and writes matched subtitles as <name>.<lang>.srt', async () => {
      const api = makeApi({
        fetchSubtitleList: mock(async () => [
          { name: 'Русский', code: 'RU', url: '/vod.do?ru' },
          { name: 'English', code: 'EN', url: '/vod.do?en' },
          { name: '简体中文', code: 'ZH_CN', url: '/vod.do?zhcn' },
        ]),
      });
      const wrapper = makeWrapper();
      const dl = new MgtvDownloader(api, wrapper);

      const result = await dl.download(makeEpisode(), dir, 'E10', {
        subLangs: ['ru.*', 'en.*', 'zho.*', 'zh.*'],
      });

      // zho.* matches nothing; ru/en/zh_cn all match here (no ZH_HK entry)
      expect(api.downloadSubtitle).toHaveBeenCalledTimes(3);
      expect(result.allFiles.filter((f) => f.endsWith('.srt')).length).toBe(3);
      const ru = await readFile(join(dir, 'E10.ru.srt'), 'utf-8');
      expect(ru).toContain('hi');
      expect(result.allFiles).toContain(join(dir, 'E10.zh_cn.srt'));
    });

    it('keeps the video when subtitle download fails (best-effort subs)', async () => {
      const api = makeApi({
        fetchSubtitleList: mock(async () => [{ name: 'Русский', code: 'RU', url: '/vod.do?ru' }]),
        resolveSubtitleUrl: mock(async () => {
          throw new Error('signed url expired');
        }),
      });
      const logs: string[] = [];
      const dl = new MgtvDownloader(api, makeWrapper());

      const result = await dl.download(makeEpisode(), dir, 'E10', {
        subLangs: ['ru.*'],
        onLog: (m) => logs.push(m),
      });

      expect(result.filename).toBe('out/E10.mp4');
      expect(logs.some((m) => m.includes('subtitle download failed'))).toBe(true);
    });

    it('continues the subtitle loop after one track fails', async () => {
      const api = makeApi({
        fetchSubtitleList: mock(async () => [
          { name: 'Русский', code: 'RU', url: '/vod.do?ru' },
          { name: 'English', code: 'EN', url: '/vod.do?en' },
          { name: '简体中文', code: 'ZH_CN', url: '/vod.do?zhcn' },
        ]),
        resolveSubtitleUrl: mock(async (entry: MgtvSubtitleEntry) => {
          if (entry.code === 'RU') throw new Error('signed url expired');
          return `https://subtitle.hitv.com/${entry.code.toLowerCase()}.srt`;
        }),
      });
      const wrapper = makeWrapper();
      const logs: string[] = [];
      const dl = new MgtvDownloader(api, wrapper);

      const result = await dl.download(makeEpisode(), dir, 'E10', {
        subLangs: ['ru.*', 'en.*', 'zho.*', 'zh.*'],
        onLog: (m) => logs.push(m),
      });

      expect(result.filename).toBe('out/E10.mp4');
      expect(wrapper.download).toHaveBeenCalledTimes(1);
      expect(result.allFiles).toContain(join(dir, 'E10.en.srt'));
      expect(result.allFiles).toContain(join(dir, 'E10.zh_cn.srt'));
      expect(result.allFiles).not.toContain(join(dir, 'E10.ru.srt'));
      expect(logs.join('\n')).toContain('subtitle download failed');
    });

    it('keeps the video when the subtitle list fetch fails', async () => {
      const api = makeApi({
        fetchSubtitleList: mock(async () => {
          throw new Error('tinker endpoint down');
        }),
      });
      const wrapper = makeWrapper();
      const logs: string[] = [];
      const dl = new MgtvDownloader(api, wrapper);

      const result = await dl.download(makeEpisode(), dir, 'E10', {
        subLangs: ['ru.*'],
        onLog: (m) => logs.push(m),
      });

      expect(result.filename).toBe('out/E10.mp4');
      expect(result.allFiles.some((f) => f.endsWith('.srt'))).toBe(false);
      expect(logs.join('\n')).toContain('subtitle download failed');
    });

    it('does not touch subtitles when subLangs is empty', async () => {
      const api = makeApi();
      const dl = new MgtvDownloader(api, makeWrapper());

      await dl.download(makeEpisode(), dir, 'E10', { subLangs: [] });

      expect(api.fetchSubtitleList).not.toHaveBeenCalled();
    });

    it('throws DownloadError when the URL has no video id', async () => {
      const dl = new MgtvDownloader(makeApi(), makeWrapper());
      const bad: Episode = { ...makeEpisode(), url: 'https://w.mgtv.com/latestart' };
      await expect(dl.download(bad, dir, 'E10')).rejects.toThrow(/video ID/i);
    });
  });
});
