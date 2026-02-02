import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { AppContext } from '../app-context.js';
import { DownloadError } from '../errors/custom-errors';
import { NotificationLevel } from '../notifications/notifier';
import type { StateManager } from '../state/state-manager';
import type { Episode } from '../types/episode.types';
import { sanitizeFilename } from '../utils/filename-sanitizer';
import * as VideoValidator from '../utils/video-validator';
import type { DownloadOptions } from './download-options.js';
import { extractDownloadOptions } from './download-options.js';
import { downloaderRegistry } from './downloader-registry';
import { YtDlpDownloader } from './impl/yt-dlp-downloader';

/**
 * Escape special characters in a string for use in a regular expression
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Download manager with progress tracking
 */
export class DownloadManager {
  private stateManager: StateManager;

  constructor() {
    // Get StateManager from AppContext
    this.stateManager = AppContext.getStateManager();
  }

  /**
   * Download an episode using appropriate downloader
   */
  async download(seriesUrl: string, episode: Episode): Promise<boolean> {
    const notifier = AppContext.getNotifier();
    const registry = AppContext.getConfig();

    // Get resolved config
    const resolved = registry.resolve(seriesUrl, 'series');
    const statePath = resolved.stateFile;
    const seriesName = resolved.name;
    const downloadOptions: DownloadOptions = extractDownloadOptions(resolved);

    // Check if already downloaded
    if (this.stateManager.isDownloaded(statePath, seriesName, episode.number)) {
      return false;
    }

    const downloader = downloaderRegistry.getDownloader(episode.url);
    notifier.notify(
      NotificationLevel.HIGHLIGHT,
      `Downloading Episode ${episode.number} of ${seriesName} using ${downloader.getName()}`,
    );

    // Calculate filename once (used in both try and catch)
    const paddedNumber = String(episode.number).padStart(2, '0');
    const sanitizedSeriesName = sanitizeFilename(seriesName);
    const filenameWithoutExt = `${sanitizedSeriesName} - ${paddedNumber}`;
    const targetDir = downloadOptions.tempDir || downloadOptions.downloadDir;

    try {
      // Clean up any artifacts from previous failed attempts
      await this.cleanupEpisodeArtifacts(targetDir, filenameWithoutExt);

      const result = await downloader.download(episode, targetDir, filenameWithoutExt, {
        cookieFile: downloadOptions.cookieFile,
        subLangs: downloadOptions.subLangs,
        onProgress: (progress) => notifier.progress(progress),
        onLog: (message) => notifier.notify(NotificationLevel.INFO, message),
      });

      // End progress display (add newline)
      notifier.endProgress();

      // Verify file exists and has size
      const fileSize = this.verifyDownload(result.filename);

      if (fileSize === 0) {
        await this.cleanupFiles(result.allFiles);
        throw new Error('Downloaded file is empty or does not exist');
      }

      // Verify duration if required
      if (downloadOptions.minDuration > 0) {
        const fullPath = resolve(result.filename);
        const duration = await VideoValidator.getVideoDuration(fullPath);
        if (duration < downloadOptions.minDuration) {
          // Delete all downloaded files
          await this.cleanupFiles(result.allFiles);
          throw new Error(`Video duration ${duration}s is less than minimum ${downloadOptions.minDuration}s`);
        }
      }

      // Move files from tempDir to downloadDir if needed
      if (downloadOptions.tempDir && downloadOptions.tempDir !== downloadOptions.downloadDir) {
        notifier.notify(
          NotificationLevel.INFO,
          `Moving files from temp directory to ${downloadOptions.downloadDir}...`,
        );

        // Ensure download directory exists
        await fsPromises.mkdir(downloadOptions.downloadDir, { recursive: true });

        for (const file of result.allFiles) {
          try {
            // Resolve 'file' to absolute path just in case
            const absFile = resolve(file);

            if (!fs.existsSync(absFile)) {
              notifier.notify(NotificationLevel.WARNING, `File not found, skipping move: ${absFile}`);
              continue;
            }

            const fileName = basename(absFile);
            const newPath = join(downloadOptions.downloadDir, fileName);
            await fsPromises.rename(absFile, newPath);

            // Update filename if it matches the main file
            if (absFile === resolve(result.filename)) {
              result.filename = newPath;
            }
          } catch (e) {
            notifier.notify(NotificationLevel.ERROR, `Failed to move file ${file}: ${e}`);
          }
        }
      }

      // Add to state
      await this.stateManager.addDownloadedEpisode(statePath, seriesName, episode.number);

      notifier.notify(
        NotificationLevel.SUCCESS,
        `Downloaded Episode ${episode.number}: ${result.filename} (${this.formatSize(fileSize)})`,
      );

      return true;
    } catch (error) {
      // End progress display on error
      notifier.endProgress();

      // Clean up any artifacts from this failed attempt
      await this.cleanupEpisodeArtifacts(targetDir, filenameWithoutExt);

      const message = `Failed to download Episode ${episode.number}: ${
        error instanceof Error ? error.message : String(error)
      }`;

      notifier.notify(NotificationLevel.ERROR, message);
      throw new DownloadError(message, episode.url);
    }
  }

  /**
   * Clean up downloaded files
   */
  private async cleanupFiles(files: string[]): Promise<void> {
    const notifier = AppContext.getNotifier();

    for (const file of files) {
      try {
        const fullPath = resolve(file);
        if (fs.existsSync(fullPath)) {
          await fsPromises.unlink(fullPath);
        }
      } catch (e) {
        notifier.notify(NotificationLevel.ERROR, `Failed to delete file ${file}: ${e}`);
      }
    }
  }

  /**
   * Clean up all files matching episode pattern (artifacts from failed downloads)
   *
   * @param dir - Directory to clean (tempDir or downloadDir)
   * @param filenameWithoutExt - Episode filename without extension (e.g., "SeriesName - 01")
   */
  private async cleanupEpisodeArtifacts(dir: string, filenameWithoutExt: string): Promise<void> {
    const notifier = AppContext.getNotifier();

    try {
      const absDir = resolve(dir);
      if (!fs.existsSync(absDir)) {
        return; // Directory doesn't exist, nothing to clean
      }

      const files = await fsPromises.readdir(absDir);
      const pattern = new RegExp(`^${escapeRegExp(filenameWithoutExt)}\\..*$`);

      let cleanedCount = 0;
      for (const file of files) {
        if (pattern.test(file)) {
          const filePath = join(absDir, file);
          try {
            await fsPromises.unlink(filePath);
            cleanedCount++;
            notifier.notify(NotificationLevel.INFO, `Cleaned up artifact: ${file}`);
          } catch (e) {
            notifier.notify(NotificationLevel.WARNING, `Failed to delete artifact ${file}: ${e}`);
          }
        }
      }

      if (cleanedCount > 0) {
        notifier.notify(NotificationLevel.INFO, `Cleaned up ${cleanedCount} artifact(s) for ${filenameWithoutExt}`);
      }
    } catch (e) {
      notifier.notify(NotificationLevel.WARNING, `Failed to cleanup artifacts in ${dir}: ${e}`);
    }
  }

  /**
   * Verify downloaded file exists and get its size
   */
  private verifyDownload(filename: string): number {
    const fullPath = resolve(filename);

    try {
      const stats = fs.statSync(fullPath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Format file size for display
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unit = 0;

    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }

    return `${size.toFixed(2)} ${units[unit]}`;
  }

  /**
   * Check if yt-dlp is installed
   */
  static async checkYtDlpInstalled(): Promise<boolean> {
    return YtDlpDownloader.checkInstalled();
  }
}
