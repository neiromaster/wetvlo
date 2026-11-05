import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DownloadError, TrialContentError } from '../../errors/custom-errors.js';
import type { Episode } from '../../types/episode.types.js';
import { extractDomain } from '../../utils/url-utils.js';
import { BaseDownloader } from '../base-downloader.js';
import type { YoukuApi, YoukuUpsResult } from '../lib/youku-api.js';
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

    // Fail fast on a misrouted URL before loading cookies
    const videoId = this.api.extractVideoId(episode.url);
    if (!videoId) {
      throw new DownloadError(`Cannot extract Youku video ID from URL: ${episode.url}`, episode.url);
    }

    // Cookies: domain-filtered at parse time — only youku.tv/youku.com pairs survive
    let cookies: string[] = [];
    if (options?.cookiesFromBrowser) {
      cookies = await this.api.readYoukuCookiePairs(options.cookiesFromBrowser);
      onLog(`Youku: loaded ${cookies.length} youku cookies`);
    }

    // Signed playlist URLs expire (~5 h): mint right before downloading.
    // With subsOnly a trial payload (locked/TVOD episode) is returned instead
    // of thrown — it still carries the full subtitle array.
    const subsOnlyMode = options?.subsOnly === true;
    const ups = await this.api.mintUps(videoId, cookies, { allowTrial: subsOnlyMode });
    onLog(`Youku: "${ups.title}" (${Math.round(ups.seconds / 60)} min, max_stream_level=${ups.maxStreamLevel ?? '?'})`);

    // Trial payloads carry preview streams only — never hand them to yt-dlp
    if (ups.trial === true && !subsOnlyMode) {
      throw new TrialContentError(
        'Youku: not logged in or cookies expired — the server issued a 6-minute trial; log in to a youku site in Firefox and make sure cookiesFromBrowser is set in config',
        episode.url,
      );
    }

    const usableStreams = ups.streams.filter(
      (s) => s.m3u8_url.startsWith('http') && (s.drm_type === undefined || s.drm_type === 'default'),
    );

    // Locked/TVOD episode with subsBeforeVideo: grab the subtitles, skip the video
    if ((ups.trial === true || usableStreams.length === 0) && subsOnlyMode) {
      const subPaths = await this.downloadSubtitles(ups, dir, filenameWithoutExt, options);
      if (subPaths.length === 0) {
        throw new DownloadError(
          'Youku: video locked (trial) and no subtitles matched subLangs — nothing to download yet',
          episode.url,
        );
      }
      onLog(`Youku: video locked (trial) — saved ${subPaths.length} subtitle track(s), video postponed`);
      return { filename: '', allFiles: subPaths, subsOnly: true };
    }

    const { stream, degraded } = pickBestStream(ups.streams);
    if (degraded) {
      onLog(`Youku: best unlocked quality is ${stream.height}p (higher tiers are DRM/locked)`);
    }

    // Signed URL works without cookies; the referer is required (verified live).
    // The minted master playlist carries EVERY audio rendition (original
    // Mandarin "guoyu", AI dubs like en/vi) and the dub is often flagged
    // DEFAULT=YES — without an explicit selector yt-dlp downloads the flagged
    // dub (observed 2026-11-05: a vi dub over the Chinese original). Prefer
    // guoyu, then any zh-family track, then yt-dlp's default choice.
    const video = await this.wrapper.download(stream.m3u8_url, filenameWithoutExt, dir, {
      args: ['--referer', 'https://www.youku.tv/', '-f', 'bv*+ba[language=guoyu]/bv*+ba[language^=zh]/bv*+ba'],
      onProgress: options?.onProgress,
      onLog: options?.onLog,
    });
    const allFiles = [...video.allFiles];

    // Subtitles are unsigned CDN files — best-effort, a failure keeps the video
    allFiles.push(...(await this.downloadSubtitles(ups, dir, filenameWithoutExt, options)));

    return { filename: video.filename, allFiles };
  }

  /**
   * Download every subLang-matching track as `<name>.<tag>.ass`. Unsigned CDN
   * files, fetched without cookies. Best-effort: individual failures are logged
   * and skipped; returns the paths actually saved.
   */
  private async downloadSubtitles(
    ups: YoukuUpsResult,
    dir: string,
    filenameWithoutExt: string,
    options?: DownloaderOptions,
  ): Promise<string[]> {
    const onLog = options?.onLog ?? (() => {});
    if (!options?.subLangs || options.subLangs.length === 0) return [];

    const saved: string[] = [];
    try {
      const subs = matchYoukuSubLangs(ups.subtitles, options.subLangs);
      onLog(`Youku: downloading ${subs.length} subtitle track(s)`);
      for (const sub of subs) {
        try {
          const text = await this.api.fetchSubtitle(sub.url);
          const subPath = join(dir, `${filenameWithoutExt}.${subtitleLangTag(sub)}.ass`);
          await writeFile(subPath, text, 'utf-8');
          saved.push(subPath);
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
    return saved;
  }
}
