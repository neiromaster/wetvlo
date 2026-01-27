import { YtDlpDownloader } from './impl/yt-dlp-downloader';
import type { Downloader } from './types';

export class DownloaderRegistry {
  private downloaders: Downloader[] = [];
  private defaultDownloader: Downloader;

  constructor() {
    this.defaultDownloader = new YtDlpDownloader();
  }

  register(downloader: Downloader): void {
    this.downloaders.push(downloader);
  }

  getDownloader(url: string): Downloader {
    // Find first specific downloader that supports the URL
    // Since default downloader returns true for everything, we check it last
    // But here we iterate registered custom downloaders first
    for (const downloader of this.downloaders) {
      if (downloader.supports(url)) {
        return downloader;
      }
    }

    return this.defaultDownloader;
  }
}

export const downloaderRegistry = new DownloaderRegistry();
