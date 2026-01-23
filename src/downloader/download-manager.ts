import { join } from 'node:path';
import { execa } from 'execa';
import { DownloadError } from '../errors/custom-errors';
import type { Notifier } from '../notifications/notifier';
import { NotificationLevel } from '../notifications/notifier';
import type { StateManager } from '../state/state-manager';
import type { Episode } from '../types/episode.types';

/**
 * Download manager for yt-dlp with progress tracking
 */
export class DownloadManager {
  private stateManager: StateManager;
  private notifier: Notifier;
  private downloadDir: string;
  private cookieFile?: string;

  constructor(stateManager: StateManager, notifier: Notifier, downloadDir: string, cookieFile?: string) {
    this.stateManager = stateManager;
    this.notifier = notifier;
    this.downloadDir = downloadDir;
    this.cookieFile = cookieFile;
  }

  /**
   * Download an episode using yt-dlp with progress tracking
   */
  async download(seriesUrl: string, seriesName: string, episode: Episode): Promise<boolean> {
    // Check if already downloaded
    if (this.stateManager.isDownloaded(seriesUrl, episode.number)) {
      return false;
    }

    this.notifier.notify(NotificationLevel.INFO, `Downloading Episode ${episode.number} of ${seriesName}`);

    try {
      const result = await this.runYtDlp(seriesName, episode);

      // Verify file exists and has size
      const fileSize = this.verifyDownload(result.filename);

      if (fileSize === 0) {
        throw new Error('Downloaded file is empty or does not exist');
      }

      // Add to state
      this.stateManager.addDownloadedEpisode(seriesUrl, seriesName, {
        number: episode.number,
        url: episode.url,
        filename: result.filename,
        size: fileSize,
      });
      await this.stateManager.save();

      this.notifier.notify(
        NotificationLevel.SUCCESS,
        `Downloaded Episode ${episode.number}: ${result.filename} (${this.formatSize(fileSize)})`,
      );

      return true;
    } catch (error) {
      const message = `Failed to download Episode ${episode.number}: ${
        error instanceof Error ? error.message : String(error)
      }`;

      this.notifier.notify(NotificationLevel.ERROR, message);
      throw new DownloadError(message, episode.url);
    }
  }

  /**
   * Run yt-dlp with execa and progress tracking
   */
  private async runYtDlp(seriesName: string, episode: Episode): Promise<{ filename: string }> {
    const paddedNumber = String(episode.number).padStart(2, '0');
    const outputTemplate = `${this.downloadDir}/${seriesName} - ${paddedNumber}.%(ext)s`;

    const args = [
      '--no-warnings',
      '--newline', // Ensure progress is on separate lines
      '--print',
      'filename', // Print filename to stdout
      '-o',
      outputTemplate,
      episode.url,
    ];

    // Add cookies if available
    if (this.cookieFile) {
      args.unshift('--cookies', this.cookieFile);
    }

    let filename: string | null = null;
    let lastProgress = '';

    try {
      const subprocess = execa('yt-dlp', args, {
        all: true, // Capture stdout and stderr together
      });

      // Process output line by line
      for await (const line of subprocess.all) {
        const text = line.toString().trim();

        // Skip empty lines
        if (!text) continue;

        // yt-dlp prints the filename on a line by itself (from --print filename)
        // It's the first non-progress line we see
        if (!text.includes('[download]') && !text.includes('[info]') && text.length > 0) {
          filename = text;
        }

        // Parse download progress
        if (text.includes('[download]')) {
          // Extract progress info
          const progressMatch = text.match(/\[(\d+\.\d+)%\]/);
          const speedMatch = text.match(/at\s+(\d+\.\d+\s*\w+\/s)/);
          const etaMatch = text.match(/ETA\s+([\d:]+)/);

          if (progressMatch) {
            const percentage = progressMatch[1];
            let progressText = `[${percentage}%]`;

            if (speedMatch) progressText += ` ${speedMatch[1]}`;
            if (etaMatch) progressText += ` ETA ${etaMatch[1]}`;

            // Only log if progress changed (reduce spam)
            if (progressText !== lastProgress) {
              this.notifier.notify(NotificationLevel.INFO, `Episode ${episode.number}: ${progressText}`);
              lastProgress = progressText;
            }
          }
        }
      }

      await subprocess;

      // If we didn't capture the filename from output, construct it
      if (!filename) {
        // Try to get the extension from yt-dlp's behavior
        // Default to mp4 if unknown
        const ext = 'mp4';
        filename = `${this.downloadDir}/${seriesName} - ${paddedNumber}.${ext}`;
      }

      return { filename };
    } catch (error) {
      // execa throws on non-zero exit
      const stderr = error.stderr ?? '';
      const stdout = error.stdout ?? '';
      throw new Error(`yt-dlp failed: ${stderr || stdout || error.message}`);
    }
  }

  /**
   * Verify downloaded file exists and get its size
   */
  private verifyDownload(filename: string): number {
    const fullPath = join(process.cwd(), filename);

    try {
      const file = Bun.file(fullPath);
      return file.size;
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
    try {
      await execa('yt-dlp', ['--version']);
      return true;
    } catch {
      return false;
    }
  }
}
