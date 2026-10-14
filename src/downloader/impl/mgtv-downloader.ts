import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DownloadError } from '../../errors/custom-errors.js';
import type { Episode } from '../../types/episode.types.js';
import { extractDomain } from '../../utils/url-utils.js';
import { BaseDownloader } from '../base-downloader.js';
import type { MgtvApi } from '../lib/mgtv-api.js';
import { extractVideoId, mgtvApi, readMgtvCookieHeader } from '../lib/mgtv-api.js';
import { pickBestStream } from '../lib/mgtv-quality.js';
import { langTag, matchSubLangs } from '../lib/mgtv-subs.js';
import { YtdlpWrapper } from '../lib/ytdlp-wrapper.js';
import type { DownloaderOptions, DownloadResult } from '../types.js';

/**
 * Downloader for MGTV International (mgtv.com / w.mgtv.com).
 *
 * Resolves stream + subtitle URLs via the tinker*.glb.mgtv.com API using
 * VIP-account cookies, then hands the signed HLS playlist to yt-dlp
 * (yt-dlp has no MGTV extractor of its own). Subtitles are downloaded
 * separately and saved next to the video as `<name>.<lang>.srt`.
 */
export class MgtvDownloader extends BaseDownloader {
  private api: MgtvApi;
  private wrapper: YtdlpWrapper;

  constructor(api: MgtvApi = mgtvApi, wrapper: YtdlpWrapper = new YtdlpWrapper()) {
    super();
    this.api = api;
    this.wrapper = wrapper;
  }

  getName(): string {
    return 'mgtv';
  }

  supports(url: string): boolean {
    try {
      const host = extractDomain(url);
      return host === 'mgtv.com' || host.endsWith('.mgtv.com');
    } catch {
      return false;
    }
  }

  async download(
    episode: Episode,
    dir: string,
    filenameWithoutExt: string,
    options?: DownloaderOptions,
  ): Promise<DownloadResult> {
    const onLog = options?.onLog ?? (() => {});

    // Cookies: domain-filtered at parse time — only mgtv.com lines survive
    let cookies: string | undefined;
    if (options?.cookieFile) {
      cookies = await readMgtvCookieHeader(options.cookieFile);
      onLog(`MGTV: loaded ${cookies.split('; ').length} mgtv.com cookies`);
    }

    const videoId = extractVideoId(episode.url);
    if (!videoId) {
      throw new DownloadError(`Cannot extract MGTV video ID from URL: ${episode.url}`, episode.url);
    }

    const info = await this.api.fetchPlayerInfo(videoId, cookies);
    onLog(`MGTV: "${info.title ?? episode.url}" (login=${info.login}, vip=${info.isvip})`);

    const source = await this.api.fetchSourceStreams(videoId, info.pm2, cookies);
    const { stream, degraded } = pickBestStream(source.streams);
    if (degraded) {
      onLog(`MGTV: highest quality is locked (VIP?), falling back to ${stream.name}`);
    }

    // Tokens are short-lived: resolve the signed playlist right before yt-dlp
    const m3u8Url = await this.api.resolveM3u8Url(source.streamDomain, stream.url);

    const video = await this.wrapper.download(m3u8Url, filenameWithoutExt, dir, {
      args: ['--referer', 'https://w.mgtv.com/'],
      onProgress: options?.onProgress,
      onLog: options?.onLog,
    });
    const allFiles = [...video.allFiles];

    // Subtitles are best-effort: a failure here keeps the valid video
    if (options?.subLangs && options.subLangs.length > 0) {
      try {
        const entries = matchSubLangs(await this.api.fetchSubtitleList(videoId, cookies), options.subLangs);
        onLog(`MGTV: downloading ${entries.length} subtitle track(s)`);
        for (const entry of entries) {
          const srtUrl = await this.api.resolveSubtitleUrl(entry);
          const srt = await this.api.downloadSubtitle(srtUrl);
          const subPath = join(dir, `${filenameWithoutExt}.${langTag(entry)}.srt`);
          await writeFile(subPath, srt, 'utf-8');
          allFiles.push(subPath);
          onLog(`MGTV: subtitle saved: ${basename(subPath)}`);
        }
      } catch (error) {
        onLog(
          `MGTV: subtitle download failed (video is kept): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { filename: video.filename, allFiles };
  }
}
