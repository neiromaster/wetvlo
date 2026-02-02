/**
 * QueueManager - Orchestrates check and download queues with UniversalScheduler
 *
 * Manages the queue-based architecture with:
 * - Per-domain check and download queues
 * - Universal scheduler for single-task execution globally
 * - Event-driven scheduling (no polling loops)
 * - Graceful shutdown
 * - Proper end-to-start cooldowns
 */

import { createHash } from 'node:crypto';
import { AppContext } from '../app-context.js';
import type { ResolvedConfig } from '../config/config-schema.js';
import type { DownloadManager } from '../downloader/download-manager.js';
import { handlerRegistry } from '../handlers/handler-registry.js';
import { NotificationLevel } from '../notifications/notifier.js';
import type { StateManager } from '../state/state-manager.js';
import type { Episode, EpisodeType } from '../types/episode.types.js';
import { extractDomain } from '../utils/url-utils.js';
import type { CheckQueueItem, DownloadQueueItem } from './types.js';
import { UniversalScheduler } from './universal-scheduler.js';

/**
 * Queue Manager for orchestrating all queues with universal scheduler
 */
export class QueueManager {
  private stateManager: StateManager;
  private downloadManager: DownloadManager;

  // Universal scheduler (handles all check and download queues)
  private scheduler: UniversalScheduler<CheckQueueItem | DownloadQueueItem>;

  // Running state
  private running = false;

  // Domain handlers cache
  private domainHandlers = new Map<string, ReturnType<typeof handlerRegistry.getHandlerOrThrow>>();

  /**
   * Create a new QueueManager
   *
   * @param downloadManager - Download manager instance
   * @param schedulerFactory - Optional factory for creating scheduler (for testing)
   */
  constructor(
    downloadManager: DownloadManager,
    schedulerFactory?: (
      executor: (task: CheckQueueItem | DownloadQueueItem, queueName: string) => Promise<void>,
    ) => UniversalScheduler<CheckQueueItem | DownloadQueueItem>,
  ) {
    // Get StateManager from AppContext
    this.stateManager = AppContext.getStateManager();
    this.downloadManager = downloadManager;

    // Create universal scheduler with executor callback
    const createScheduler = schedulerFactory || ((executor) => new UniversalScheduler(executor));
    this.scheduler = createScheduler(async (task, queueName) => {
      await this.executeTask(task, queueName);
    });

    // Set up wait notification
    this.scheduler.setOnWait((queueName, waitMs) => {
      const notifier = AppContext.getNotifier();
      const seconds = Math.round(waitMs / 1000);
      const parts = queueName.split(':');
      const type = parts[0];
      const domain = parts[1];

      if (type === 'download') {
        notifier.notify(NotificationLevel.INFO, `[${domain}] Next download in ${seconds}s...`);
      } else if (type === 'check') {
        notifier.notify(NotificationLevel.INFO, `[${domain}] Next check in ${seconds}s...`);
      }
    });
  }

  /**
   * Add a series to the check queue
   *
   * @param seriesUrl - Series URL
   */
  addSeriesCheck(seriesUrl: string): void {
    const notifier = AppContext.getNotifier();
    const registry = AppContext.getConfig();
    const domain = extractDomain(seriesUrl);

    // Get series name from resolved config for notification
    const config = registry.resolve(seriesUrl, 'series');
    const seriesName = config.name;

    // Register download queue for this domain (shared across series)
    this.registerDownloadQueue(domain);

    // Register specific check queue for this series (isolated interval)
    const queueName = this.registerSeriesCheckQueue(domain, seriesUrl);

    // Add series to check queue
    const item: CheckQueueItem = {
      seriesUrl,
      attemptNumber: 1,
      retryCount: 0,
    };

    this.scheduler.addTask(queueName, item);

    notifier.notify(NotificationLevel.INFO, `[QueueManager] Added ${seriesName} to check queue for domain ${domain}`);
  }

  /**
   * Add episodes to the download queue
   *
   * @param seriesUrl - Series URL
   * @param episodes - Episodes to download
   */
  addEpisodes(seriesUrl: string, episodes: Episode[]): void {
    const notifier = AppContext.getNotifier();
    const registry = AppContext.getConfig();

    if (episodes.length === 0) {
      return;
    }

    // Get series name from resolved config for notification
    const resolvedConfig = registry.resolve(seriesUrl, 'series');
    const seriesName = resolvedConfig.name;
    const domain = extractDomain(seriesUrl);

    // Register download queues for this domain if not already registered
    this.registerDownloadQueue(domain);

    // Get download delay from resolved config
    const { downloadDelay } = resolvedConfig.download;

    // Add episodes to download queue with staggered delays
    for (let i = 0; i < episodes.length; i++) {
      const episode = episodes[i];
      if (!episode) continue;

      const item: DownloadQueueItem = {
        seriesUrl,
        episode,
        retryCount: 0,
      };

      const queueName = `download:${domain}`;
      // Stagger episodes by downloadDelay
      const delayMs = i * downloadDelay * 1000;
      this.scheduler.addTask(queueName, item, delayMs);
    }

    notifier.notify(
      NotificationLevel.SUCCESS,
      `[QueueManager] Added ${episodes.length} episodes to download queue for ${seriesName} (domain ${domain})`,
    );
  }

  /**
   * Update configuration
   */
  updateConfig(): void {
    const notifier = AppContext.getNotifier();
    // Config is reloaded in AppContext, we just need to notify
    notifier.notify(NotificationLevel.INFO, '[QueueManager] Configuration will be reloaded from AppContext');
  }

  /**
   * Start all queues
   */
  start(): void {
    const notifier = AppContext.getNotifier();

    if (this.running) {
      throw new Error('QueueManager is already running');
    }

    this.running = true;
    this.scheduler.resume();

    notifier.notify(NotificationLevel.INFO, '[QueueManager] Started queue processing');
  }

  /**
   * Stop all queues gracefully
   *
   * Waits for current task to complete.
   */
  async stop(): Promise<void> {
    const notifier = AppContext.getNotifier();

    if (!this.running) {
      return;
    }

    notifier.notify(NotificationLevel.INFO, '[QueueManager] Stopping queue processing...');

    this.scheduler.stop();
    this.running = false;

    notifier.notify(NotificationLevel.INFO, '[QueueManager] Queue processing stopped');
  }

  /**
   * Check if there is active processing or pending tasks
   *
   * @returns Whether scheduler is actively processing or has pending tasks
   */
  hasActiveProcessing(): boolean {
    return this.scheduler.isExecutorBusy() || this.scheduler.hasPendingTasks();
  }

  /**
   * Get queue statistics
   *
   * @returns Object with queue statistics
   */
  getQueueStats(): {
    checkQueues: Record<string, { length: number; processing: boolean }>;
    downloadQueues: Record<string, { length: number; processing: boolean }>;
  } {
    const stats = this.scheduler.getStats();
    const checkQueues: Record<string, { length: number; processing: boolean }> = {};
    const downloadQueues: Record<string, { length: number; processing: boolean }> = {};

    for (const [queueName, queueStats] of stats.entries()) {
      if (queueName.startsWith('check:')) {
        const parts = queueName.split(':');
        const domain = parts[1]; // Extract domain from check:domain:hash
        if (!domain) continue;

        if (!checkQueues[domain]) {
          checkQueues[domain] = { length: 0, processing: false };
        }

        checkQueues[domain].length += queueStats.queueLength;
        if (queueStats.isExecuting) {
          checkQueues[domain].processing = true;
        }
      } else if (queueName.startsWith('download:')) {
        const domain = queueName.slice(9); // Remove "download:" prefix
        downloadQueues[domain] = {
          length: queueStats.queueLength,
          processing: queueStats.isExecuting,
        };
      }
    }

    return { checkQueues, downloadQueues };
  }

  /**
   * Register download queue for a domain (shared across series)
   */
  private registerDownloadQueue(domain: string): void {
    const registry = AppContext.getConfig();
    const queueName = `download:${domain}`;

    // Check if queue is already registered
    if (this.scheduler.hasQueue(queueName)) {
      return;
    }

    // Resolve configuration - use any URL from this domain to get domain-level config
    const testUrl = `https://${domain}/`;
    const resolvedConfig = registry.resolve(testUrl, 'domain');
    const { downloadDelay } = resolvedConfig.download;

    // Register queue with scheduler
    this.scheduler.registerQueue(queueName, downloadDelay * 1000); // Convert to ms
  }

  /**
   * Register specific check queue for a series (isolated interval)
   */
  private registerSeriesCheckQueue(domain: string, seriesUrl: string): string {
    const registry = AppContext.getConfig();

    // Generate a short hash of the URL to ensure uniqueness and safe queue name
    const hash = createHash('md5').update(seriesUrl).digest('hex').substring(0, 12);
    const queueName = `check:${domain}:${hash}`;

    // Check if queue is already registered
    if (this.scheduler.hasQueue(queueName)) {
      return queueName;
    }

    // Resolve configuration
    const resolvedConfig = registry.resolve(seriesUrl, 'series');
    const { checkInterval } = resolvedConfig.check;

    // Register queue with scheduler
    this.scheduler.registerQueue(queueName, checkInterval * 1000); // Convert to ms

    // Ensure we have a handler for this domain
    if (!this.domainHandlers.has(domain)) {
      const handler = handlerRegistry.getHandlerOrThrow(`https://${domain}/`);
      this.domainHandlers.set(domain, handler);
    }

    return queueName;
  }

  /**
   * Execute a task from the scheduler
   *
   * This is the executor callback that handles both check and download tasks.
   *
   * @param task - Task to execute
   * @param queueName - Queue name (format: "check:domain" or "download:domain")
   */
  private async executeTask(task: CheckQueueItem | DownloadQueueItem, queueName: string): Promise<void> {
    const parts = queueName.split(':');
    const type = parts[0];
    const domain = parts[1];

    if (!type || !domain) {
      throw new Error(`Invalid queue name format: ${queueName}`);
    }

    if (type === 'check') {
      await this.executeCheck(task as CheckQueueItem, domain, queueName);
    } else if (type === 'download') {
      await this.executeDownload(task as DownloadQueueItem, domain, queueName);
    } else {
      throw new Error(`Unknown queue type: ${type}`);
    }
  }

  /**
   * Execute a check task
   *
   * @param item - Check queue item
   * @param domain - Domain name
   * @param queueName - Queue name for scheduler callbacks
   */
  private async executeCheck(item: CheckQueueItem, domain: string, queueName: string): Promise<void> {
    const notifier = AppContext.getNotifier();
    const registry = AppContext.getConfig();
    const { seriesUrl, attemptNumber, retryCount = 0 } = item;

    // Get handler for this domain
    const handler = this.domainHandlers.get(domain);
    if (!handler) {
      throw new Error(`No handler found for domain ${domain}`);
    }

    // Get settings
    const resolvedConfig = registry.resolve(seriesUrl, 'series');
    const seriesName = resolvedConfig.name;
    const { count: checksCount, checkInterval } = resolvedConfig.check;

    try {
      // Perform the check
      const result = await this.performCheck(handler, seriesUrl, resolvedConfig, attemptNumber, domain);

      if (result.hasNewEpisodes) {
        // Episodes found - send to download queue, do NOT requeue
        notifier.notify(
          NotificationLevel.SUCCESS,
          `[${domain}] Found ${result.episodes.length} new episodes for ${seriesName} (attempt ${attemptNumber}/${checksCount})`,
        );

        // Add episodes to download queue
        this.addEpisodes(seriesUrl, result.episodes);

        // Session complete - do not requeue
        this.scheduler.markTaskComplete(queueName, checkInterval * 1000);
      } else {
        // No episodes found - check if we should requeue
        if (attemptNumber < checksCount) {
          // Requeue with interval delay
          const intervalMs = checkInterval * 1000;
          const requeueDelay = result.requeueDelay ?? intervalMs;

          notifier.notify(
            NotificationLevel.INFO,
            `[${domain}] No new episodes for ${seriesName} (attempt ${attemptNumber}/${checksCount}), requeueing in ${Math.round(requeueDelay / 1000)}s`,
          );

          // Requeue with incremented attempt number
          const requeuedItem: CheckQueueItem = {
            seriesUrl,
            attemptNumber: attemptNumber + 1,
            retryCount: 0,
          };

          this.scheduler.addTask(queueName, requeuedItem, requeueDelay);
          this.scheduler.markTaskComplete(queueName, checkInterval * 1000);
        } else {
          // Checks exhausted - do not requeue
          notifier.notify(
            NotificationLevel.INFO,
            `[${domain}] Checks exhausted for ${seriesName} (${checksCount} attempts with no new episodes)`,
          );
          this.scheduler.markTaskComplete(queueName, checkInterval * 1000);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Get download settings for retry config
      const { maxRetries, initialTimeout, backoffMultiplier, jitterPercentage } = resolvedConfig.download;

      if (retryCount < maxRetries) {
        // Retry with exponential backoff (convert seconds to ms)
        const retryDelay = this.calculateBackoff(
          retryCount,
          initialTimeout * 1000,
          backoffMultiplier,
          jitterPercentage,
        );

        notifier.notify(
          NotificationLevel.WARNING,
          `[${domain}] Check failed for ${seriesName}, retrying in ${Math.round(retryDelay / 1000)}s (attempt ${retryCount + 1}/${maxRetries})`,
        );

        // Requeue with incremented retry count (same attempt number)
        const requeuedItem: CheckQueueItem = {
          seriesUrl,
          attemptNumber,
          retryCount: retryCount + 1,
        };

        this.scheduler.addPriorityTask(queueName, requeuedItem, retryDelay);
        this.scheduler.markTaskComplete(queueName, checkInterval * 1000);
      } else {
        // Max retries exceeded - log error and give up
        notifier.notify(
          NotificationLevel.ERROR,
          `[${domain}] Failed to check ${seriesName} after ${retryCount} retry attempts: ${errorMessage}`,
        );
        this.scheduler.markTaskComplete(queueName, checkInterval * 1000);
      }
    }
  }

  /**
   * Execute a download task
   *
   * @param item - Download queue item
   * @param domain - Domain name
   * @param queueName - Queue name for scheduler callbacks
   */
  private async executeDownload(item: DownloadQueueItem, domain: string, queueName: string): Promise<void> {
    const notifier = AppContext.getNotifier();
    const registry = AppContext.getConfig();
    const { seriesUrl, episode, retryCount = 0 } = item;

    // Resolve config
    const resolvedConfig = registry.resolve(seriesUrl, 'series');
    const seriesName = resolvedConfig.name;
    const { downloadDelay } = resolvedConfig.download;

    try {
      // Attempt download
      await this.downloadManager.download(seriesUrl, episode);

      // Success - log and continue
      notifier.notify(
        NotificationLevel.SUCCESS,
        `[${domain}] Successfully queued download of Episode ${episode.number} for ${seriesName}`,
      );

      this.scheduler.markTaskComplete(queueName, downloadDelay * 1000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if we should retry
      const { maxRetries, initialTimeout, backoffMultiplier, jitterPercentage } = resolvedConfig.download;

      if (retryCount < maxRetries) {
        // Retry with backoff
        const retryDelay = this.calculateBackoff(
          retryCount,
          initialTimeout * 1000, // convert seconds to ms
          backoffMultiplier,
          jitterPercentage,
        );

        notifier.notify(
          NotificationLevel.WARNING,
          `[${domain}] Download failed for Episode ${episode.number}, retrying in ${Math.round(retryDelay / 1000)}s (attempt ${retryCount + 1}/${maxRetries})`,
        );

        // Requeue with incremented retry count
        const requeuedItem: DownloadQueueItem = {
          seriesUrl,
          episode,
          retryCount: retryCount + 1,
        };

        this.scheduler.addPriorityTask(queueName, requeuedItem, retryDelay);
        this.scheduler.markTaskComplete(queueName, downloadDelay * 1000);
      } else {
        // Max retries exceeded - log error and give up
        notifier.notify(
          NotificationLevel.ERROR,
          `[${domain}] Failed to download Episode ${episode.number} after ${retryCount + 1} attempts: ${errorMessage}`,
        );
        this.scheduler.markTaskComplete(queueName, downloadDelay * 1000);
      }
    }
  }

  /**
   * Perform the actual check for new episodes
   *
   * @param handler - Domain handler
   * @param seriesUrl - Series URL
   * @param config - Resolved series configuration
   * @param attemptNumber - Current attempt number
   * @param domain - Domain name
   * @returns Check result
   */
  private async performCheck(
    handler: ReturnType<typeof handlerRegistry.getHandlerOrThrow>,
    seriesUrl: string,
    config: ResolvedConfig<'series'>,
    attemptNumber: number,
    domain: string,
  ): Promise<{ hasNewEpisodes: boolean; episodes: Episode[]; requeueDelay?: number }> {
    const notifier = AppContext.getNotifier();
    const seriesName = config.name;
    const checksCount = config.check.count;

    notifier.notify(
      NotificationLevel.INFO,
      `[${domain}] Checking ${seriesUrl} for new episodes... (attempt ${attemptNumber}/${checksCount})`,
    );

    // Extract episodes from the series page
    const episodes = await handler.extractEpisodes(seriesUrl);

    // Log episodes by type
    const episodesByType = new Map<EpisodeType, number>();
    episodes.forEach((ep) => {
      const count = episodesByType.get(ep.type) || 0;
      episodesByType.set(ep.type, count + 1);
    });

    const typeSummary = Array.from(episodesByType.entries())
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');

    notifier.notify(
      NotificationLevel.INFO,
      `[${domain}] Found ${episodes.length} total episodes on ${seriesUrl} (${typeSummary})`,
    );

    // Get download types from config
    const { downloadTypes } = config.check;

    // Filter for episodes matching download types and not yet downloaded
    const newEpisodes = episodes.filter((ep) => {
      const shouldDownload = downloadTypes.includes(ep.type as EpisodeType);
      // Get state path from config
      const statePath = config.stateFile;
      const notDownloaded = !this.stateManager.isDownloaded(statePath, seriesName, ep.number);
      return shouldDownload && notDownloaded;
    });

    // Log how many episodes will be downloaded
    if (episodes.length !== newEpisodes.length) {
      const skippedCount = episodes.length - newEpisodes.length;
      notifier.notify(
        NotificationLevel.INFO,
        `[${domain}] Filtering to ${downloadTypes.join(' or ')}: ${newEpisodes.length} episodes to download, ${skippedCount} skipped`,
      );
    }

    if (newEpisodes.length > 0) {
      return {
        hasNewEpisodes: true,
        episodes: newEpisodes,
      };
    }

    // No new episodes
    return {
      hasNewEpisodes: false,
      episodes: [],
      shouldRequeue: true,
    } as { hasNewEpisodes: false; episodes: Episode[]; requeueDelay?: number };
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
