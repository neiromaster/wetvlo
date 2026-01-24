import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import { DownloadError } from '../errors/custom-errors';
import type { Notifier } from '../notifications/notifier';
import { NotificationLevel } from '../notifications/notifier';
import type { StateManager } from '../state/state-manager';
import type { Episode } from '../types/episode.types';
import { VideoValidator } from '../utils/video-validator';

/**
 * Error type returned by execa when a subprocess fails
 */
type ExecaError = {
  stderr?: string;
  stdout?: string;
  message?: string;
};

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
  async download(seriesUrl: string, seriesName: string, episode: Episode, minDuration: number = 0): Promise<boolean> {
    // Check if already downloaded
    if (this.stateManager.isDownloaded(seriesUrl, episode.number)) {
      return false;
    }

    this.notifier.notify(NotificationLevel.HIGHLIGHT, `Downloading Episode ${episode.number} of ${seriesName}`);

    try {
      const result = await this.runYtDlp(seriesName, episode);

      // Verify file exists and has size
      const fileSize = this.verifyDownload(result.filename);

      if (fileSize === 0) {
        throw new Error('Downloaded file is empty or does not exist');
      }

      // Verify duration if required
      if (minDuration > 0) {
        const fullPath = join(process.cwd(), result.filename);
        const duration = await VideoValidator.getVideoDuration(fullPath);

        if (duration < minDuration) {
          // Delete invalid file
          try {
            await unlink(fullPath);
          } catch (e) {
            this.notifier.notify(NotificationLevel.ERROR, `Failed to delete invalid file ${result.filename}: ${e}`);
          }

          throw new Error(`Video duration ${duration}s is less than minimum ${minDuration}s`);
        }
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

    const args = ['--no-warnings', '--newline', '-o', outputTemplate, episode.url];

    if (this.cookieFile) {
      args.unshift('--cookies', this.cookieFile);
    }

    let filename: string | null = null;
    const outputBuffer: string[] = [];

    try {
      const subprocess = execa('yt-dlp', args, { all: true });

      for await (const line of subprocess.all) {
        const text = line.toString().trim();
        if (!text) continue;

        // Buffer all output for error debugging
        outputBuffer.push(text);

        // Capture filename from "[download] Destination: ..." line
        const destMatch = text.match(/\[download\] Destination:\s*(.+)/);
        if (destMatch) {
          filename = destMatch[1];
        }

        // Status messages: [info], [ffmpeg], [merge] - check FIRST
        if (
          text.includes('[info]') ||
          text.includes('[ffmpeg]') ||
          text.includes('[merge]') ||
          text.includes('[postprocessor]')
        ) {
          this.notifier.notify(NotificationLevel.INFO, `Episode ${episode.number}: ${text}`);
          continue;
        }

        // Detailed progress with file size
        if (text.includes('[download]')) {
          // Match: [download]  23.8% of ~ 145.41MiB at  563.37KiB/s ETA 03:34 (frag 48/203)
          // or:    [download]   0.0% of ~  68.02MiB at    2.83KiB/s ETA Unknown (frag 0/203)
          // The format has:
          // - Optional ~ before size (indicates estimated)
          // - (frag X/Y) suffix at end
          // - Extra whitespace
          // - ETA can be "Unknown" or a time like "03:34"
          const progressMatch = text.match(
            /\[download\]\s+(\d+\.?\d*)%\s+of\s+~?\s*([\d.]+\w+)\s+at\s+~?\s*([\d.]+\w+\/s)\s+ETA\s+(\S+)/,
          );

          if (progressMatch) {
            const [, percentage, totalSize, speed, eta] = progressMatch;
            // Use progress() to update on same line
            this.notifier.progress(`[${episode.number}] ${percentage}% of ${totalSize} at ${speed} ETA ${eta}`);
          } else {
            // Other download status: Destination, Resuming, etc. - show normally
            this.notifier.notify(NotificationLevel.INFO, `Episode ${episode.number}: ${text}`);
          }
        }
      }

      await subprocess;

      // End progress display (add newline)
      this.notifier.endProgress();

      if (!filename) {
        filename = `${this.downloadDir}/${seriesName} - ${paddedNumber}.mp4`;
      }

      return { filename };
    } catch (error) {
      // End progress display on error
      this.notifier.endProgress();

      const err = error as ExecaError;
      const stderr = err.stderr ?? '';
      const stdout = err.stdout ?? '';
      const allOutput = outputBuffer.join('\n');

      throw new Error(
        `yt-dlp failed:\n` +
          `stderr: ${stderr}\n` +
          `stdout: ${stdout}\n` +
          `captured output:\n${allOutput}\n` +
          `message: ${err.message}`,
      );
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
