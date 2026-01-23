/**
 * DownloadQueue - Queue for downloading episodes
 *
 * Manages download queue for a specific domain with:
 * - Sequential downloads (concatMap)
 * - Retry with exponential backoff on failure
 * - Configurable delays between downloads
 * - Multiple episode scheduling with delays
 */

import { DEFAULT_DOWNLOAD_SETTINGS } from '../config/config-defaults.js';
import type { DownloadManager } from '../downloader/download-manager.js';
import type { Notifier } from '../notifications/notifier.js';
import { NotificationLevel } from '../notifications/notifier.js';
import type { Episode } from '../types/episode.types.js';
import { AsyncQueue } from './async-queue.js';
import { calculateBackoff, sleep } from './retry-strategy.js';
import type { DomainConfig, DownloadQueueItem, DownloadResult, QueueProcessor } from './types.js';

/**
 * Download Queue for a specific domain
 */
export class DownloadQueue extends AsyncQueue<DownloadQueueItem> {
  private downloadManager: DownloadManager;
  private notifier: Notifier;
  private domainConfig: DomainConfig;
  private domain: string;

  /**
   * Create a new DownloadQueue
   *
   * @param domain - Domain name (e.g., "wetv.vip")
   * @param domainConfig - Domain configuration
   * @param downloadManager - Download manager instance
   * @param notifier - Notifier for progress updates
   */
  constructor(domain: string, domainConfig: DomainConfig, downloadManager: DownloadManager, notifier: Notifier) {
    const processor: QueueProcessor<DownloadQueueItem> = async (item) => {
      await this.processDownload(item);
    };

    super(processor);

    this.domain = domain;
    this.domainConfig = domainConfig;
    this.downloadManager = downloadManager;
    this.notifier = notifier;
  }

  /**
   * Add a single episode to the download queue
   *
   * @param seriesUrl - Series URL
   * @param seriesName - Series name
   * @param episode - Episode to download
   * @param delay - Delay in seconds before starting download (default: domain downloadDelay)
   */
  addEpisode(seriesUrl: string, seriesName: string, episode: Episode, delay?: number): void {
    const downloadDelay = this.domainConfig.download?.downloadDelay ?? DEFAULT_DOWNLOAD_SETTINGS.downloadDelay;
    const delayMs = (delay ?? downloadDelay) * 1000;
    const scheduledTime = new Date(Date.now() + delayMs);

    const item: DownloadQueueItem = {
      seriesUrl,
      seriesName,
      episode,
      scheduledTime,
      retryCount: 0,
    };

    this.add(item);
  }

  /**
   * Add multiple episodes to the download queue with delays between them
   *
   * Episodes are scheduled with the domain's downloadDelay between each.
   *
   * @param seriesUrl - Series URL
   * @param seriesName - Series name
   * @param episodes - Episodes to download
   */
  addEpisodes(seriesUrl: string, seriesName: string, episodes: Episode[]): void {
    let cumulativeDelay = 0;

    const downloadDelay = this.domainConfig.download?.downloadDelay ?? DEFAULT_DOWNLOAD_SETTINGS.downloadDelay;

    for (const episode of episodes) {
      this.addEpisode(seriesUrl, seriesName, episode, cumulativeDelay);
      cumulativeDelay += downloadDelay;
    }
  }

  /**
   * Get the domain for this queue
   *
   * @returns Domain name
   */
  getDomain(): string {
    return this.domain;
  }

  /**
   * Process a single download with retry logic
   *
   * @param item - Download queue item
   */
  private async processDownload(item: DownloadQueueItem): Promise<void> {
    const { seriesUrl, seriesName, episode, scheduledTime, retryCount = 0 } = item;

    // Wait until scheduled time if specified
    if (scheduledTime && scheduledTime > new Date()) {
      const delayMs = scheduledTime.getTime() - Date.now();
      await sleep(delayMs);
    }

    try {
      // Attempt download
      await this.downloadManager.download(seriesUrl, seriesName, episode);

      // Success - log and continue
      this.notifier.notify(
        NotificationLevel.SUCCESS,
        `[${this.domain}] Successfully queued download of Episode ${episode.number} for ${seriesName}`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if we should retry
      const result = this.shouldRetryDownload(retryCount, errorMessage);

      if (result.shouldRetry) {
        // Retry with backoff
        const retryDelay = result.retryDelay ?? 5000;
        const maxRetries = this.domainConfig.download?.maxRetries ?? DEFAULT_DOWNLOAD_SETTINGS.maxRetries;
        this.notifier.notify(
          NotificationLevel.WARNING,
          `[${this.domain}] Download failed for Episode ${episode.number}, retrying in ${Math.round(retryDelay / 1000)}s (attempt ${retryCount + 1}/${maxRetries})`,
        );

        await sleep(retryDelay);

        // Requeue with incremented retry count
        this.add({
          ...item,
          retryCount: retryCount + 1,
        });
      } else {
        // Max retries exceeded - log error and give up
        this.notifier.notify(
          NotificationLevel.ERROR,
          `[${this.domain}] Failed to download Episode ${episode.number} after ${retryCount} attempts: ${errorMessage}`,
        );
      }
    }

    // Add delay between downloads (unless queue is empty)
    const downloadDelay = this.domainConfig.download?.downloadDelay ?? DEFAULT_DOWNLOAD_SETTINGS.downloadDelay;
    if (this.getQueueLength() > 0) {
      await sleep(downloadDelay * 1000);
    }
  }

  /**
   * Determine if a download should be retried
   *
   * @param retryCount - Current retry count
   * @param errorMessage - Error message from failed download
   * @returns Download result with retry decision
   */
  private shouldRetryDownload(retryCount: number, errorMessage: string): DownloadResult {
    const downloadSettings = this.domainConfig.download;
    const maxRetries = downloadSettings?.maxRetries ?? DEFAULT_DOWNLOAD_SETTINGS.maxRetries;
    const initialTimeout = downloadSettings?.initialTimeout ?? DEFAULT_DOWNLOAD_SETTINGS.initialTimeout;
    const backoffMultiplier = downloadSettings?.backoffMultiplier ?? DEFAULT_DOWNLOAD_SETTINGS.backoffMultiplier;
    const jitterPercentage = downloadSettings?.jitterPercentage ?? DEFAULT_DOWNLOAD_SETTINGS.jitterPercentage;

    if (retryCount >= maxRetries) {
      return {
        success: false,
        error: errorMessage,
        shouldRetry: false,
      };
    }

    const retryDelay = calculateBackoff(
      retryCount,
      initialTimeout * 1000, // convert seconds to ms
      backoffMultiplier,
      jitterPercentage,
    );

    return {
      success: false,
      error: errorMessage,
      shouldRetry: true,
      retryDelay,
    };
  }
}
