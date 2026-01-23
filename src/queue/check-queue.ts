/**
 * CheckQueue - Queue for checking series for new episodes
 *
 * Manages check queue for a specific domain with:
 * - Sequential checks (concatMap)
 * - Retry with exponential backoff on error
 * - Requeue with interval when no new episodes found
 * - Track attempts per session (checks limit)
 * - Send episodes to download queue when found
 */

import {
  DEFAULT_CHECK_SETTINGS,
  DEFAULT_DOWNLOAD_SETTINGS,
  DEFAULT_DOWNLOAD_TYPES_ENUM,
} from '../config/config-defaults.js';
import type { Notifier } from '../notifications/notifier.js';
import { NotificationLevel } from '../notifications/notifier.js';
import type { StateManager } from '../state/state-manager.js';
import type { Episode } from '../types/episode.types.js';
import { EpisodeType } from '../types/episode.types.js';
import type { DomainHandler } from '../types/handler.types.js';
import { AsyncQueue } from './async-queue.js';
import { sleep } from './retry-strategy.js';
import type { CheckQueueItem, CheckResult, DomainConfig, QueueProcessor } from './types.js';

/**
 * Check Queue for a specific domain
 */
export class CheckQueue extends AsyncQueue<CheckQueueItem> {
  private handler: DomainHandler;
  private stateManager: StateManager;
  private notifier: Notifier;
  private domainConfig: DomainConfig;
  private domain: string;

  // Callback for when new episodes are found
  private onEpisodesFound?: (seriesUrl: string, seriesName: string, episodes: Episode[]) => void;

  /**
   * Create a new CheckQueue
   *
   * @param domain - Domain name (e.g., "wetv.vip")
   * @param domainConfig - Domain configuration
   * @param handler - Domain handler for extracting episodes
   * @param stateManager - State manager for checking downloaded episodes
   * @param notifier - Notifier for progress updates
   * @param onEpisodesFound - Callback when new episodes are found
   */
  constructor(
    domain: string,
    domainConfig: DomainConfig,
    handler: DomainHandler,
    stateManager: StateManager,
    notifier: Notifier,
    onEpisodesFound?: (seriesUrl: string, seriesName: string, episodes: Episode[]) => void,
  ) {
    const processor: QueueProcessor<CheckQueueItem> = async (item) => {
      await this.processCheck(item);
    };

    super(processor);

    this.domain = domain;
    this.domainConfig = domainConfig;
    this.handler = handler;
    this.stateManager = stateManager;
    this.notifier = notifier;
    this.onEpisodesFound = onEpisodesFound;
  }

  /**
   * Add a series check to the queue
   *
   * @param seriesUrl - Series URL
   * @param seriesName - Series name
   * @param config - Series configuration
   * @param attemptNumber - Current attempt number (default: 1)
   */
  addSeriesCheck(
    seriesUrl: string,
    seriesName: string,
    config: import('../types/config.types.js').SeriesConfig,
    attemptNumber: number = 1,
  ): void {
    const item: CheckQueueItem = {
      seriesUrl,
      seriesName,
      config,
      attemptNumber,
      retryCount: 0,
    };

    this.add(item);
  }

  /**
   * Reset attempts for a series (e.g., after rescheduling)
   *
   * @param seriesUrl - Series URL to reset
   */
  resetAttempts(_seriesUrl: string): void {
    // In the queue-based system, attempts are tracked per CheckQueueItem
    // To reset, we would need to modify items already in the queue
    // For now, this is a placeholder for future implementation
    // The scheduler will naturally reset attempts when rescheduling
  }

  /**
   * Set the callback for when episodes are found
   *
   * @param callback - Callback function
   */
  onEpisodesFoundCallback(callback: (seriesUrl: string, seriesName: string, episodes: Episode[]) => void): void {
    this.onEpisodesFound = callback;
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
   * Process a single check with retry and requeue logic
   *
   * @param item - Check queue item
   */
  private async processCheck(item: CheckQueueItem): Promise<void> {
    const { seriesUrl, seriesName, config, attemptNumber, retryCount = 0, scheduledTime } = item;

    // Wait until scheduled time if specified
    if (scheduledTime && scheduledTime > new Date()) {
      const delayMs = scheduledTime.getTime() - Date.now();
      await sleep(delayMs);
    }

    try {
      // Perform the check
      const result = await this.performCheck(seriesUrl, seriesName, config, attemptNumber);

      // Get check count from config (series, domain, global, or hardcoded default)
      const checksCount = config.check?.count ?? this.domainConfig.check?.count ?? DEFAULT_CHECK_SETTINGS.count;
      // Get check interval from config (series, domain, global, or hardcoded default)
      const checkInterval =
        config.check?.checkInterval ?? this.domainConfig.check?.checkInterval ?? DEFAULT_CHECK_SETTINGS.checkInterval;

      if (result.hasNewEpisodes) {
        // Episodes found - send to download queue, do NOT requeue
        this.notifier.notify(
          NotificationLevel.SUCCESS,
          `[${this.domain}] Found ${result.episodes.length} new episodes for ${seriesName} (attempt ${attemptNumber}/${checksCount})`,
        );

        // Trigger callback to send episodes to download queue
        if (this.onEpisodesFound) {
          this.onEpisodesFound(seriesUrl, seriesName, result.episodes);
        }

        // Session complete - do not requeue
        // Scheduler will reschedule for next startTime
      } else {
        // No episodes found - check if we should requeue
        if (attemptNumber < checksCount) {
          // Requeue with interval delay
          const intervalMs = checkInterval * 1000;
          const requeueDelay = result.requeueDelay ?? intervalMs;

          this.notifier.notify(
            NotificationLevel.INFO,
            `[${this.domain}] No new episodes for ${seriesName} (attempt ${attemptNumber}/${checksCount}), requeueing in ${Math.round(requeueDelay / 1000)}s`,
          );

          await sleep(requeueDelay);

          // Requeue with incremented attempt number
          this.add({
            ...item,
            attemptNumber: attemptNumber + 1,
            retryCount: 0,
            scheduledTime: new Date(Date.now() + requeueDelay),
          });
        } else {
          // Checks exhausted - do not requeue
          this.notifier.notify(
            NotificationLevel.INFO,
            `[${this.domain}] Checks exhausted for ${seriesName} (${checksCount} attempts with no new episodes)`,
          );
          // Scheduler will reschedule for next startTime
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Get download settings for retry config
      const downloadSettings = this.domainConfig.download;
      const maxRetries = downloadSettings?.maxRetries ?? DEFAULT_DOWNLOAD_SETTINGS.maxRetries;
      const initialTimeout = downloadSettings?.initialTimeout ?? DEFAULT_DOWNLOAD_SETTINGS.initialTimeout;
      const backoffMultiplier = downloadSettings?.backoffMultiplier ?? DEFAULT_DOWNLOAD_SETTINGS.backoffMultiplier;
      const jitterPercentage = downloadSettings?.jitterPercentage ?? DEFAULT_DOWNLOAD_SETTINGS.jitterPercentage;

      if (retryCount < maxRetries) {
        // Retry with exponential backoff (convert seconds to ms)
        const retryDelay = this.calculateBackoff(
          retryCount,
          initialTimeout * 1000,
          backoffMultiplier,
          jitterPercentage,
        );

        this.notifier.notify(
          NotificationLevel.WARNING,
          `[${this.domain}] Check failed for ${seriesName}, retrying in ${Math.round(retryDelay / 1000)}s (attempt ${retryCount + 1}/${maxRetries})`,
        );

        await sleep(retryDelay);

        // Requeue with incremented retry count (same attempt number)
        this.add({
          ...item,
          retryCount: retryCount + 1,
          scheduledTime: new Date(Date.now() + retryDelay),
        });
      } else {
        // Max retries exceeded - log error and give up
        this.notifier.notify(
          NotificationLevel.ERROR,
          `[${this.domain}] Failed to check ${seriesName} after ${retryCount} retry attempts: ${errorMessage}`,
        );
      }
    }

    // Add delay between checks (interval)
    // Get check interval from config
    const checkInterval =
      config.check?.checkInterval ?? this.domainConfig.check?.checkInterval ?? DEFAULT_CHECK_SETTINGS.checkInterval;
    const intervalMs = checkInterval * 1000;
    // Wait before processing next item in queue
    if (this.getQueueLength() > 0) {
      await sleep(intervalMs);
    }
  }

  /**
   * Perform the actual check for new episodes
   *
   * @param seriesUrl - Series URL
   * @param _seriesName - Series name
   * @param config - Series configuration
   * @param attemptNumber - Current attempt number
   * @returns Check result
   */
  private async performCheck(
    seriesUrl: string,
    _seriesName: string,
    config: import('../types/config.types.js').SeriesConfig,
    attemptNumber: number,
  ): Promise<CheckResult> {
    const checksCount = config.check?.count ?? this.domainConfig.check?.count ?? DEFAULT_CHECK_SETTINGS.count;

    this.notifier.notify(
      NotificationLevel.INFO,
      `[${this.domain}] Checking ${seriesUrl} for new episodes... (attempt ${attemptNumber}/${checksCount})`,
    );

    // Extract episodes from the series page
    const episodes = await this.handler.extractEpisodes(seriesUrl);

    this.notifier.notify(
      NotificationLevel.INFO,
      `[${this.domain}] Found ${episodes.length} total episodes on ${seriesUrl}`,
    );

    // Get download types from config or use defaults
    const downloadTypes = this.getDownloadTypes(config);

    // Filter for episodes matching download types and not yet downloaded
    const newEpisodes = episodes.filter((ep) => {
      const shouldDownload = downloadTypes.includes(ep.type as EpisodeType);
      const notDownloaded = !this.stateManager.isDownloaded(seriesUrl, ep.number);
      return shouldDownload && notDownloaded;
    });

    if (newEpisodes.length > 0) {
      return {
        hasNewEpisodes: true,
        episodes: newEpisodes,
        shouldRequeue: false,
      };
    }

    // No new episodes
    return {
      hasNewEpisodes: false,
      episodes: [],
      shouldRequeue: true,
    };
  }

  /**
   * Get episode types to download from config or use defaults
   *
   * @param config - Series configuration
   * @returns Array of episode types
   */
  private getDownloadTypes(config: import('../types/config.types.js').SeriesConfig): EpisodeType[] {
    // Get from series config, domain config, or use defaults
    const downloadTypes =
      config.check?.downloadTypes ?? this.domainConfig.check?.downloadTypes ?? DEFAULT_DOWNLOAD_TYPES_ENUM;

    // Convert string types from config to EpisodeType enum
    return downloadTypes.map((typeStr): EpisodeType => {
      switch (typeStr) {
        case 'available':
          return EpisodeType.AVAILABLE;
        case 'vip':
          return EpisodeType.VIP;
        case 'teaser':
          return EpisodeType.TEASER;
        case 'express':
          return EpisodeType.EXPRESS;
        case 'preview':
          return EpisodeType.PREVIEW;
        case 'locked':
          return EpisodeType.LOCKED;
        default:
          // Default to available for unknown types
          return EpisodeType.AVAILABLE;
      }
    });
  }

  /**
   * Calculate exponential backoff with jitter
   *
   * @param retryCount - Current retry count
   * @param initialTimeout - Initial timeout in ms
   * @param backoffMultiplier - Multiplier for exponential backoff
   * @param jitterPercentage - Percentage of jitter (0-100)
   * @returns Delay in milliseconds
   */
  private calculateBackoff(
    retryCount: number,
    initialTimeout: number,
    backoffMultiplier: number,
    jitterPercentage: number,
  ): number {
    // Calculate base delay with exponential backoff
    const baseDelay = initialTimeout * backoffMultiplier ** retryCount;

    // Calculate jitter amount
    const jitterAmount = (baseDelay * jitterPercentage) / 100;

    // Generate random jitter within ±jitterAmount
    const jitter = (Math.random() * 2 - 1) * jitterAmount;

    // Calculate final delay (ensure non-negative)
    const finalDelay = Math.max(0, baseDelay + jitter);

    return Math.floor(finalDelay);
  }
}
