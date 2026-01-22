import type { DownloadManager } from '../downloader/download-manager';
import type { Notifier } from '../notifications/notifier';
import { NotificationLevel } from '../notifications/notifier';
import type { StateManager } from '../state/state-manager';
import type { SeriesConfig } from '../types/config.types';
import type { DomainHandler } from '../types/handler.types';
import { sleep } from '../utils/time-utils';

/**
 * Task runner for checking a single series
 */
export class TaskRunner {
  private config: SeriesConfig;
  private handler: DomainHandler;
  private stateManager: StateManager;
  private downloadManager: DownloadManager;
  private notifier: Notifier;
  private cookies?: string;
  private singleRun: boolean = false;
  private shouldStop: boolean = false;

  constructor(
    config: SeriesConfig,
    handler: DomainHandler,
    stateManager: StateManager,
    downloadManager: DownloadManager,
    notifier: Notifier,
    cookies?: string,
    singleRun: boolean = false,
  ) {
    this.config = config;
    this.handler = handler;
    this.stateManager = stateManager;
    this.downloadManager = downloadManager;
    this.notifier = notifier;
    this.cookies = cookies;
    this.singleRun = singleRun;
  }

  /**
   * Stop the task runner
   */
  stop(): void {
    this.shouldStop = true;
  }

  /**
   * Run the task (check for new episodes)
   */
  async run(): Promise<void> {
    this.notifier.notify(NotificationLevel.INFO, `Checking ${this.config.url} for new episodes...`);

    try {
      // Extract episodes from the series page
      const episodes = await this.handler.extractEpisodes(this.config.url, this.cookies);

      this.notifier.notify(NotificationLevel.INFO, `Found ${episodes.length} episodes on ${this.config.url}`);

      // Filter for available episodes not yet downloaded
      const newEpisodes = episodes.filter(
        (ep) => ep.type === 'available' && !this.stateManager.isDownloaded(this.config.url, ep.number),
      );

      if (newEpisodes.length > 0) {
        this.notifier.notify(
          NotificationLevel.SUCCESS,
          `Found ${newEpisodes.length} new episodes for ${this.config.url}`,
        );

        // Download each new episode
        for (const episode of newEpisodes) {
          if (this.shouldStop) break;

          await this.downloadManager.download(this.config.url, episode);

          // Small delay between downloads
          await sleep(1000);
        }
      } else {
        this.notifier.notify(NotificationLevel.INFO, `No new episodes found for ${this.config.url}`);
      }
    } catch (error) {
      this.notifier.notify(
        NotificationLevel.ERROR,
        `Error checking ${this.config.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Run multiple checks with intervals
   */
  async runMultipleChecks(): Promise<void> {
    // In single-run mode, just run once
    if (this.singleRun) {
      await this.run();
      return;
    }

    // Scheduled mode: run multiple checks with intervals
    const { checks, interval } = this.config;

    for (let i = 0; i < checks; i++) {
      if (this.shouldStop) break;

      this.notifier.notify(NotificationLevel.INFO, `Check ${i + 1}/${checks} for ${this.config.url}`);

      await this.run();

      // Wait before next check (if not the last one)
      if (i < checks - 1 && !this.shouldStop) {
        await sleep(interval * 1000);
      }
    }
  }
}
