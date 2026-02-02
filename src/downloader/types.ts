import type { Episode } from '../types/episode.types';

export type DownloadResult = {
  /** Main file path (video) */
  filename: string;
  /** All downloaded/generated files (video, subs, etc.) */
  allFiles: string[];
};

export type DownloaderOptions = {
  cookieFile?: string;
  /** List of subtitle languages to download (e.g., ['en', 'ru']) */
  subLangs?: string[];
  /** Callback for progress updates (e.g. percentage, ETA) - usually printed on same line */
  onProgress?: (progress: string) => void;
  /** Callback for log messages (e.g. info, extracting) - printed as new lines */
  onLog?: (message: string) => void;
};

export type Downloader = {
  /**
   * Get downloader name
   */
  getName(): string;

  /**
   * Check if this downloader supports the given URL
   */
  supports(url: string): boolean;

  /**
   * Download episode
   * @param episode Episode to download
   * @param dir Target directory
   * @param filenameWithoutExt Desired filename without extension
   * @param options Download options
   */
  download(
    episode: Episode,
    dir: string,
    filenameWithoutExt: string,
    options?: DownloaderOptions,
  ): Promise<DownloadResult>;
};
