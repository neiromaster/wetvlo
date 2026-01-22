import { spawn } from 'node:child_process';
import { DownloadError } from '../errors/custom-errors';
import type { Notifier } from '../notifications/notifier';
import { NotificationLevel } from '../notifications/notifier';
import type { StateManager } from '../state/state-manager';
import type { DownloadedEpisode, Episode } from '../types/episode.types';

/**
 * Download manager for yt-dlp
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
   * Download an episode using yt-dlp
   */
  async download(seriesUrl: string, episode: Episode): Promise<DownloadedEpisode | null> {
    // Check if already downloaded
    if (this.stateManager.isDownloaded(seriesUrl, episode.number)) {
      return null;
    }

    this.notifier.notify(NotificationLevel.INFO, `Downloading Episode ${episode.number} from ${seriesUrl}`);

    try {
      const filename = await this.runYtDlp(episode);

      const downloadedEpisode: DownloadedEpisode = {
        number: episode.number,
        url: episode.url,
        downloadedAt: new Date().toISOString(),
        seriesUrl,
        filename,
      };

      // Add to state
      this.stateManager.addDownloadedEpisode(downloadedEpisode);
      await this.stateManager.save();

      this.notifier.notify(NotificationLevel.SUCCESS, `Downloaded Episode ${episode.number}: ${filename}`);

      return downloadedEpisode;
    } catch (error) {
      const message = `Failed to download Episode ${episode.number}: ${
        error instanceof Error ? error.message : String(error)
      }`;

      this.notifier.notify(NotificationLevel.ERROR, message);
      throw new DownloadError(message, episode.url);
    }
  }

  /**
   * Run yt-dlp command
   */
  private async runYtDlp(episode: Episode): Promise<string> {
    const args = ['--no-warnings', '--print', 'filename', '-o', `${this.downloadDir}/%(title)s.%(ext)s`, episode.url];

    // Add cookies if available
    if (this.cookieFile) {
      args.unshift('--cookies', this.cookieFile);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('yt-dlp', args);
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on('data', (chunk) => {
        stdoutChunks.push(chunk);
      });

      proc.stderr.on('data', (chunk) => {
        stderrChunks.push(chunk);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const filename = Buffer.concat(stdoutChunks).toString().trim();
          resolve(filename);
        } else {
          const error = Buffer.concat(stderrChunks).toString();
          reject(new Error(`yt-dlp exited with code ${code}: ${error}`));
        }
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
      });
    });
  }

  /**
   * Check if yt-dlp is installed
   */
  static async checkYtDlpInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('yt-dlp', ['--version']);
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => {
        resolve(false);
      });
    });
  }
}
