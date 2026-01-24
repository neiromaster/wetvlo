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

import { ConfigResolver } from '../config/config-resolver.js';
import type { ResolvedSeriesConfig } from '../config/resolved-config.types.js';
import type { DownloadManager } from '../downloader/download-manager.js';
import { handlerRegistry } from '../handlers/handler-registry.js';
import type { Notifier } from '../notifications/notifier.js';
import { NotificationLevel } from '../notifications/notifier.js';
import type { StateManager } from '../state/state-manager.js';
import type { GlobalConfigs, SeriesConfig } from '../types/config.types.js';
import type { Episode, EpisodeType } from '../types/episode.types.js';
import { extractDomain } from '../utils/url-utils.js';
import type { CheckQueueItem, DomainConfig, DownloadQueueItem } from './types.js';
import { UniversalScheduler } from './universal-scheduler.js';

/**
 * Queue Manager for orchestrating all queues with universal scheduler
 */
export class QueueManager {
  private stateManager: StateManager;
  private downloadManager: DownloadManager;
  private notifier: Notifier;

  // Universal scheduler (handles all check and download queues)
  private scheduler: UniversalScheduler<CheckQueueItem | DownloadQueueItem>;

  // Config resolver
  private configResolver: ConfigResolver;

  // Running state
  private running = false;

  // Domain handlers cache
  private domainHandlers = new Map<string, ReturnType<typeof handlerRegistry.getHandlerOrThrow>>();

  /**
   * Create a new QueueManager
   *
   * @param stateManager - State manager instance
   * @param downloadManager - Download manager instance
   * @param notifier - Notifier instance
   * @param _cookieFile - Optional cookie file path (unused, kept for API compatibility)
   * @param domainConfigs - Optional domain configurations
   * @param globalConfigs - Optional global configuration defaults
   */
  constructor(
    stateManager: StateManager,
    downloadManager: DownloadManager,
    notifier: Notifier,
    _cookieFile: string | undefined,
    domainConfigs: DomainConfig[] = [],
    globalConfigs?: GlobalConfigs,
    schedulerFactory?: (
      executor: (task: CheckQueueItem | DownloadQueueItem, queueName: string) => Promise<void>,
    ) => UniversalScheduler<CheckQueueItem | DownloadQueueItem>,
  ) {
    this.stateManager = stateManager;
    this.downloadManager = downloadManager;
    this.notifier = notifier;

    // Initialize config resolver
    this.configResolver = new ConfigResolver(domainConfigs, globalConfigs);

    // Create universal scheduler with executor callback
    const createScheduler = schedulerFactory || ((executor) => new UniversalScheduler(executor));
    this.scheduler = createScheduler(async (task, queueName) => {
      await this.executeTask(task, queueName);
    });

    // Set up wait notification
    this.scheduler.setOnWait((queueName, waitMs) => {
      const seconds = Math.round(waitMs / 1000);
      const parts = queueName.split(':');
      const type = parts[0];
      const domain = parts[1];

      if (type === 'download') {
        this.notifier.notify(NotificationLevel.INFO, `[${domain}] Next download in ${seconds}s...`);
      } else if (type === 'check') {
        this.notifier.notify(NotificationLevel.INFO, `[${domain}] Next check in ${seconds}s...`);
      }
    });
  }

  /**
   * Add a series to the check queue
   *
   * @param config - Series configuration
   */
  addSeriesCheck(config: SeriesConfig): void {
    const domain = extractDomain(config.url);

    // Register queues for this domain if not already registered
    this.registerDomainQueues(domain);

    // Add series to check queue with config
    const item: CheckQueueItem = {
      seriesUrl: config.url,
      seriesName: config.name,
      config: config,
      attemptNumber: 1,
      retryCount: 0,
    };

    const queueName = `check:${domain}`;
    this.scheduler.addTask(queueName, item);

    this.notifier.notify(
      NotificationLevel.INFO,
      `[QueueManager] Added ${config.name} to check queue for domain ${domain}`,
    );
  }

  /**
   * Add episodes to the download queue
   *
   * @param seriesUrl - Series URL
   * @param seriesName - Series name
   * @param episodes - Episodes to download
   * @param config - Series configuration (optional)
   */
  addEpisodes(seriesUrl: string, seriesName: string, episodes: Episode[], config?: SeriesConfig): void {
    if (episodes.length === 0) {
      return;
    }

    const domain = extractDomain(seriesUrl);

    // Register queues for this domain if not already registered
    this.registerDomainQueues(domain);

    // Get download delay from resolved config
    const resolvedConfig = this.configResolver.resolveDomain(domain);
    const { downloadDelay } = resolvedConfig.download;

    // Add episodes to download queue with staggered delays
    for (let i = 0; i < episodes.length; i++) {
      const episode = episodes[i];
      if (!episode) continue;

      const item: DownloadQueueItem = {
        seriesUrl,
        seriesName,
        episode,
        config,
        retryCount: 0,
      };

      const queueName = `download:${domain}`;
      // Stagger episodes by downloadDelay
      const delayMs = i * downloadDelay * 1000;
      this.scheduler.addTask(queueName, item, delayMs);
    }

    this.notifier.notify(
      NotificationLevel.SUCCESS,
      `[QueueManager] Added ${episodes.length} episodes to download queue for ${seriesName} (domain ${domain})`,
    );
  }

  /**
   * Start all queues
   */
  start(): void {
    if (this.running) {
      throw new Error('QueueManager is already running');
    }

    this.running = true;
    this.scheduler.resume();

    this.notifier.notify(NotificationLevel.INFO, '[QueueManager] Started queue processing');
  }

  /**
   * Stop all queues gracefully
   *
   * Waits for current task to complete.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.notifier.notify(NotificationLevel.INFO, '[QueueManager] Stopping queue processing...');

    this.scheduler.stop();
    this.running = false;

    this.notifier.notify(NotificationLevel.INFO, '[QueueManager] Queue processing stopped');
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
        const domain = queueName.slice(6); // Remove "check:" prefix
        checkQueues[domain] = {
          length: queueStats.queueLength,
          processing: queueStats.isExecuting,
        };
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
   * Register queues for a domain if not already registered
   *
   * @param domain - Domain name
   */
  private registerDomainQueues(domain: string): void {
    const checkQueueName = `check:${domain}`;
    const downloadQueueName = `download:${domain}`;

    // Check if queues are already registered
    const existingStats = this.scheduler.getStats();
    if (existingStats.has(checkQueueName) && existingStats.has(downloadQueueName)) {
      return;
    }

    // Resolve configuration
    const resolvedConfig = this.configResolver.resolveDomain(domain);

    // Get handler for this domain
    const handler = handlerRegistry.getHandlerOrThrow(`https://${domain}/`);
    this.domainHandlers.set(domain, handler);

    // Get cooldowns
    const { checkInterval } = resolvedConfig.check;
    const { downloadDelay } = resolvedConfig.download;

    // Register queues with scheduler
    this.scheduler.registerQueue(checkQueueName, checkInterval * 1000); // Convert to ms
    this.scheduler.registerQueue(downloadQueueName, downloadDelay * 1000); // Convert to ms
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
    const { seriesUrl, seriesName, config, attemptNumber, retryCount = 0 } = item;

    // Get handler for this domain
    const handler = this.domainHandlers.get(domain);
    if (!handler) {
      throw new Error(`No handler found for domain ${domain}`);
    }

    // Get settings
    const resolvedConfig = this.configResolver.resolve(config);
    const { count: checksCount, checkInterval } = resolvedConfig.check;

    try {
      // Perform the check
      const result = await this.performCheck(handler, seriesUrl, seriesName, resolvedConfig, attemptNumber, domain);

      if (result.hasNewEpisodes) {
        // Episodes found - send to download queue, do NOT requeue
        this.notifier.notify(
          NotificationLevel.SUCCESS,
          `[${domain}] Found ${result.episodes.length} new episodes for ${seriesName} (attempt ${attemptNumber}/${checksCount})`,
        );

        // Add episodes to download queue
        this.addEpisodes(seriesUrl, seriesName, result.episodes, config);

        // Session complete - do not requeue
        this.scheduler.markTaskComplete(queueName, checkInterval * 1000);
      } else {
        // No episodes found - check if we should requeue
        if (attemptNumber < checksCount) {
          // Requeue with interval delay
          const intervalMs = checkInterval * 1000;
          const requeueDelay = result.requeueDelay ?? intervalMs;

          this.notifier.notify(
            NotificationLevel.INFO,
            `[${domain}] No new episodes for ${seriesName} (attempt ${attemptNumber}/${checksCount}), requeueing in ${Math.round(requeueDelay / 1000)}s`,
          );

          // Requeue with incremented attempt number
          const requeuedItem: CheckQueueItem = {
            ...item,
            attemptNumber: attemptNumber + 1,
            retryCount: 0,
          };

          this.scheduler.addTask(queueName, requeuedItem, requeueDelay);
          this.scheduler.markTaskComplete(queueName, checkInterval * 1000);
        } else {
          // Checks exhausted - do not requeue
          this.notifier.notify(
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

        this.notifier.notify(
          NotificationLevel.WARNING,
          `[${domain}] Check failed for ${seriesName}, retrying in ${Math.round(retryDelay / 1000)}s (attempt ${retryCount + 1}/${maxRetries})`,
        );

        // Requeue with incremented retry count (same attempt number)
        const requeuedItem: CheckQueueItem = {
          ...item,
          retryCount: retryCount + 1,
        };

        this.scheduler.addPriorityTask(queueName, requeuedItem, retryDelay);
        this.scheduler.markTaskComplete(queueName, checkInterval * 1000);
      } else {
        // Max retries exceeded - log error and give up
        this.notifier.notify(
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
    const { seriesUrl, seriesName, episode, config, retryCount = 0 } = item;

    // Resolve config
    let resolvedConfig: ResolvedSeriesConfig;
    if (config) {
      resolvedConfig = this.configResolver.resolve(config);
    } else {
      resolvedConfig = this.configResolver.resolveDomain(domain);
    }

    const { downloadDelay, minDuration } = resolvedConfig.download;

    try {
      // Attempt download
      await this.downloadManager.download(seriesUrl, seriesName, episode, minDuration);

      // Success - log and continue
      this.notifier.notify(
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

        this.notifier.notify(
          NotificationLevel.WARNING,
          `[${domain}] Download failed for Episode ${episode.number}, retrying in ${Math.round(retryDelay / 1000)}s (attempt ${retryCount + 1}/${maxRetries})`,
        );

        // Requeue with incremented retry count
        const requeuedItem: DownloadQueueItem = {
          ...item,
          retryCount: retryCount + 1,
        };

        this.scheduler.addPriorityTask(queueName, requeuedItem, retryDelay);
        this.scheduler.markTaskComplete(queueName, downloadDelay * 1000);
      } else {
        // Max retries exceeded - log error and give up
        this.notifier.notify(
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
   * @param _seriesName - Series name
   * @param config - Series configuration
   * @param attemptNumber - Current attempt number
   * @param domain - Domain name
   * @returns Check result
   */
  private async performCheck(
    handler: ReturnType<typeof handlerRegistry.getHandlerOrThrow>,
    seriesUrl: string,
    _seriesName: string,
    config: ResolvedSeriesConfig,
    attemptNumber: number,
    domain: string,
  ): Promise<{ hasNewEpisodes: boolean; episodes: Episode[]; requeueDelay?: number }> {
    const checksCount = config.check.count;

    this.notifier.notify(
      NotificationLevel.INFO,
      `[${domain}] Checking ${seriesUrl} for new episodes... (attempt ${attemptNumber}/${checksCount})`,
    );

    // Extract episodes from the series page
    const episodes = await handler.extractEpisodes(seriesUrl);

    this.notifier.notify(NotificationLevel.INFO, `[${domain}] Found ${episodes.length} total episodes on ${seriesUrl}`);

    // Get download types from config
    const downloadTypes = config.check.downloadTypes;

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

  /**
   * Set global configs (for dependency injection)
   */
  setGlobalConfigs(globalConfigs: GlobalConfigs): void {
    this.configResolver.setGlobalConfigs(globalConfigs);
  }
}
