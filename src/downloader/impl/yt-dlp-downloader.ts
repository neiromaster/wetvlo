import type { Episode } from '../../types/episode.types.js';
import { BaseDownloader } from '../base-downloader.js';
import { YtdlpWrapper } from '../lib/ytdlp-wrapper.js';
import type { DownloaderOptions, DownloadResult } from '../types.js';

export class YtDlpDownloader extends BaseDownloader {
  private wrapper = new YtdlpWrapper();

  getName(): string {
    return 'yt-dlp';
  }

  supports(_url: string): boolean {
    return true; // Default downloader supports everything (or tries to)
  }

  async download(
    episode: Episode,
    dir: string,
    filenameWithoutExt: string,
    options?: DownloaderOptions,
  ): Promise<DownloadResult> {
    // Use wrapper with preset args for video download
    // Note: wrapper already handles URL, so we don't need to pass it in args
    return this.wrapper.download(episode.url, filenameWithoutExt, dir, {
      args: [], // No additional args needed for basic download
      cookieFile: options?.cookieFile,
      subLangs: options?.subLangs,
      onProgress: options?.onProgress,
      onLog: options?.onLog,
    });
  }

  /**
   * Check if yt-dlp is installed
   */
  static async checkInstalled(): Promise<boolean> {
    return YtdlpWrapper.checkInstalled();
  }
}
