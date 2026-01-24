import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execa } from 'execa';
import { DownloadError } from '../errors/custom-errors';
import type { Notifier } from '../notifications/notifier';
import { NotificationLevel } from '../notifications/notifier';
import type { StateManager } from '../state/state-manager';
import type { Episode } from '../types/episode.types';
import { sanitizeFilename } from '../utils/filename-sanitizer';
import * as VideoValidator from '../utils/video-validator';

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
  private tempDir?: string;
  private cookieFile?: string;

  constructor(
    stateManager: StateManager,
    notifier: Notifier,
    downloadDir: string,
    cookieFile?: string,
    tempDir?: string,
  ) {
    this.stateManager = stateManager;
    this.notifier = notifier;
    this.downloadDir = resolve(downloadDir);
    this.cookieFile = cookieFile ? resolve(cookieFile) : undefined;
    this.tempDir = tempDir ? resolve(tempDir) : undefined;
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
        await this.cleanupFiles(result.allFiles);
        throw new Error('Downloaded file is empty or does not exist');
      }

      // Verify duration if required
      if (minDuration > 0) {
        const fullPath = resolve(result.filename);
        const duration = await VideoValidator.getVideoDuration(fullPath);
        if (duration < minDuration) {
          // Delete all downloaded files
          await this.cleanupFiles(result.allFiles);
          throw new Error(`Video duration ${duration}s is less than minimum ${minDuration}s`);
        }
      }

      // Move files from tempDir to downloadDir if needed
      if (this.tempDir && this.tempDir !== this.downloadDir) {
        this.notifier.notify(NotificationLevel.INFO, `Moving files from temp directory to ${this.downloadDir}...`);

        // Ensure download directory exists
        await fsPromises.mkdir(this.downloadDir, { recursive: true });

        for (const file of result.allFiles) {
          try {
            // Resolve 'file' to absolute path just in case
            const absFile = resolve(file);

            if (!fs.existsSync(absFile)) {
              this.notifier.notify(NotificationLevel.WARNING, `File not found, skipping move: ${absFile}`);
              continue;
            }

            const fileName = basename(absFile);
            const newPath = join(this.downloadDir, fileName);
            await fsPromises.rename(absFile, newPath);

            // Update filename if it matches the main file
            if (absFile === resolve(result.filename)) {
              result.filename = newPath;
            }
          } catch (e) {
            this.notifier.notify(NotificationLevel.ERROR, `Failed to move file ${file}: ${e}`);
          }
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
   * Clean up downloaded files
   */
  private async cleanupFiles(files: string[]): Promise<void> {
    for (const file of files) {
      try {
        const fullPath = resolve(file);
        if (fs.existsSync(fullPath)) {
          await fsPromises.unlink(fullPath);
        }
      } catch (e) {
        this.notifier.notify(NotificationLevel.ERROR, `Failed to delete file ${file}: ${e}`);
      }
    }
  }

  /**
   * Run yt-dlp with execa and progress tracking
   */
  private async runYtDlp(seriesName: string, episode: Episode): Promise<{ filename: string; allFiles: string[] }> {
    const paddedNumber = String(episode.number).padStart(2, '0');
    const targetDir = this.tempDir || this.downloadDir;

    // Ensure directory exists
    await fsPromises.mkdir(targetDir, { recursive: true });

    const sanitizedSeriesName = sanitizeFilename(seriesName);
    const outputTemplate = join(targetDir, `${sanitizedSeriesName} - ${paddedNumber}.%(ext)s`);

    const args = ['--no-warnings', '--newline', '-o', outputTemplate, episode.url];

    if (this.cookieFile) {
      args.unshift('--cookies', this.cookieFile);
    }

    let filename: string | null = null;
    const allFiles: Set<string> = new Set();
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
          if (filename) allFiles.add(filename);
        }

        // Capture subtitles from "[info] Writing video subtitles to: ..."
        const subMatch = text.match(/\[info\] Writing video subtitles to:\s*(.+)/);
        if (subMatch?.[1]) {
          allFiles.add(subMatch[1]);
        }

        // Capture merged file from "[merge] Merging formats into "..."
        const mergeMatch = text.match(/\[merge\] Merging formats into "(.*)"/);
        if (mergeMatch) {
          filename = mergeMatch[1];
          if (filename) allFiles.add(filename);
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
        // Fallback if we couldn't parse the filename
        filename = join(targetDir, `${sanitizedSeriesName} - ${paddedNumber}.mp4`);
      }

      // Ensure the main filename is included in allFiles
      if (filename && !allFiles.has(filename)) {
        allFiles.add(filename);
      }

      return { filename, allFiles: Array.from(allFiles) };
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
    try {
      await execa('yt-dlp', ['--version']);
      return true;
    } catch {
      return false;
    }
  }
}
