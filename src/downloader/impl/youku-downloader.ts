import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DownloadError } from '../../errors/custom-errors.js';
import type { Episode } from '../../types/episode.types.js';
import { extractDomain } from '../../utils/url-utils.js';
import { BaseDownloader } from '../base-downloader.js';
import type { YoukuApi } from '../lib/youku-api.js';
import { matchYoukuSubLangs, pickBestStream, subtitleLangTag, youkuApi } from '../lib/youku-api.js';
import { YtdlpWrapper } from '../lib/ytdlp-wrapper.js';
import type { DownloaderOptions, DownloadResult } from '../types.js';

/**
 * Downloader for Youku International (youku.tv).
 *
 * Mints the signed HLS playlist through the ups API right before downloading
 * (signed URLs expire after ~5 h), then hands it to yt-dlp WITHOUT cookies —
 * the signature is the only auth — but with a youku.tv referer. Subtitles are
 * unsigned .ass CDN links fetched separately and saved as
 * `<name>.<lang>.ass` sidecars.
 */
export class YoukuDownloader extends BaseDownloader {
  private api: YoukuApi;
  private wrapper: YtdlpWrapper;

  constructor(api: YoukuApi = youkuApi, wrapper: YtdlpWrapper = new YtdlpWrapper()) {
    super();
    this.api = api;
    this.wrapper = wrapper;
  }

  getName(): string {
    return 'youku';
  }

  supports(url: string): boolean {
    try {
      const host = extractDomain(url);
      return host === 'youku.tv' || host.endsWith('.youku.tv');
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

    // Fail fast on a misrouted URL before touching the cookie file
    const videoId = this.api.extractVideoId(episode.url);
    if (!videoId) {
      throw new DownloadError(`Cannot extract Youku video ID from URL: ${episode.url}`, episode.url);
    }

    // Cookies: domain-filtered at parse time — only youku.tv/youku.com pairs survive
    let cookies: string[] = [];
    if (options?.cookieFile) {
      cookies = await this.api.readYoukuCookiePairs(options.cookieFile);
      onLog(`Youku: loaded ${cookies.length} youku cookies`);
    }

    // Signed playlist URLs expire (~5 h): mint right before downloading
    const ups = await this.api.mintUps(videoId, cookies);
    onLog(`Youku: "${ups.title}" (${Math.round(ups.seconds / 60)} min, max_stream_level=${ups.maxStreamLevel ?? '?'})`);

    const { stream, degraded } = pickBestStream(ups.streams);
    if (degraded) {
      onLog(`Youku: best unlocked quality is ${stream.height}p (higher tiers are DRM/locked)`);
    }

    // Signed URL works without cookies; the referer is required (verified live)
    const video = await this.wrapper.download(stream.m3u8_url, filenameWithoutExt, dir, {
      args: ['--referer', 'https://www.youku.tv/'],
      onProgress: options?.onProgress,
      onLog: options?.onLog,
    });
    const allFiles = [...video.allFiles];

    // Subtitles are unsigned CDN files — best-effort, a failure keeps the video
    if (options?.subLangs && options.subLangs.length > 0) {
      try {
        const subs = matchYoukuSubLangs(ups.subtitles, options.subLangs);
        onLog(`Youku: downloading ${subs.length} subtitle track(s)`);
        for (const sub of subs) {
          try {
            const text = await this.api.fetchSubtitle(sub.url);
            const subPath = join(dir, `${filenameWithoutExt}.${subtitleLangTag(sub)}.ass`);
            await writeFile(subPath, text, 'utf-8');
            allFiles.push(subPath);
            onLog(`Youku: subtitle saved: ${basename(subPath)}`);
          } catch (error) {
            onLog(
              `Youku: subtitle download failed (video is kept): ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } catch (error) {
        onLog(
          `Youku: subtitle download failed (video is kept): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { filename: video.filename, allFiles };
  }
}
