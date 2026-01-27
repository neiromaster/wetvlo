import type { Episode } from '../types/episode.types';
import type { Downloader, DownloaderOptions, DownloadResult } from './types';

export abstract class BaseDownloader implements Downloader {
  abstract getName(): string;
  abstract supports(url: string): boolean;
  abstract download(
    episode: Episode,
    dir: string,
    filenameWithoutExt: string,
    options?: DownloaderOptions,
  ): Promise<DownloadResult>;
}
