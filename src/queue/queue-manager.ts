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

import { DEFAULT_CHECK_SETTINGS, DEFAULT_DOWNLOAD_SETTINGS } from '../config/config-defaults.js';
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

  // Domain configurations
  private domainConfigs: Map<string, DomainConfig> = new Map();

  // Global defaults
  private globalConfigs?: GlobalConfigs;

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
  ) {
    this.stateManager = stateManager;
    this.downloadManager = downloadManager;
    this.notifier = notifier;
    this.globalConfigs = globalConfigs;

    // Initialize domain configurations
    for (const config of domainConfigs) {
      this.domainConfigs.set(config.domain, config);
    }

    // Create universal scheduler with executor callback
    this.scheduler = new UniversalScheduler<CheckQueueItem | DownloadQueueItem>(async (task, queueName) => {
      await this.executeTask(task, queueName);
    });
  }

  /**
   * Add a series to the check queue
   *
   * @param config - Series configuration
   */
  addSeriesCheck(config: SeriesConfig): void {
    const domain = extractDomain(config.url);

    // Merge config with defaults from all 4 levels
    const mergedConfig = this.mergeSeriesConfig(config, domain);

    // Register queues for this domain if not already registered
    this.registerDomainQueues(domain);

    // Get check interval from merged config
    const _checkInterval =
      mergedConfig.check?.checkInterval ??
      this.domainConfigs.get(domain)?.check?.checkInterval ??
      this.globalConfigs?.check?.checkInterval ??
      DEFAULT_CHECK_SETTINGS.checkInterval;

    // Add series to check queue with merged config
    const item: CheckQueueItem = {
      seriesUrl: mergedConfig.url,
      seriesName: mergedConfig.name,
      config: mergedConfig,
      attemptNumber: 1,
      retryCount: 0,
    };

    const queueName = `check:${domain}`;
    this.scheduler.addTask(queueName, item);

    this.notifier.notify(
      NotificationLevel.INFO,
      `[QueueManager] Added ${mergedConfig.name} to check queue for domain ${domain}`,
    );
  }

  /**
   * Merge series configuration with defaults from 4 levels
   *
   * Level 1 (highest): Series config
   * Level 2: Domain config
   * Level 3: Global defaults (globalConfigs)
   * Level 4 (lowest): Hardcoded defaults
   *
   * @param config - Series configuration
   * @param domain - Domain name
   * @returns Merged series configuration
   */
  private mergeSeriesConfig(config: SeriesConfig, domain: string): SeriesConfig {
    const domainConfig = this.domainConfigs.get(domain);
    const globalCheck = this.globalConfigs?.check;
    const globalDownload = this.globalConfigs?.download;

    return {
      ...config,
      check: {
        count: config.check?.count ?? domainConfig?.check?.count ?? globalCheck?.count ?? DEFAULT_CHECK_SETTINGS.count,
        checkInterval:
          config.check?.checkInterval ??
          domainConfig?.check?.checkInterval ??
          globalCheck?.checkInterval ??
          DEFAULT_CHECK_SETTINGS.checkInterval,
        downloadTypes: config.check?.downloadTypes ?? domainConfig?.check?.downloadTypes ?? globalCheck?.downloadTypes,
      },
      download: {
        downloadDelay:
          config.download?.downloadDelay ??
          domainConfig?.download?.downloadDelay ??
          globalDownload?.downloadDelay ??
          DEFAULT_DOWNLOAD_SETTINGS.downloadDelay,
        maxRetries:
          config.download?.maxRetries ??
          domainConfig?.download?.maxRetries ??
          globalDownload?.maxRetries ??
          DEFAULT_DOWNLOAD_SETTINGS.maxRetries,
        initialTimeout:
          config.download?.initialTimeout ??
          domainConfig?.download?.initialTimeout ??
          globalDownload?.initialTimeout ??
          DEFAULT_DOWNLOAD_SETTINGS.initialTimeout,
        backoffMultiplier:
          config.download?.backoffMultiplier ??
          domainConfig?.download?.backoffMultiplier ??
          globalDownload?.backoffMultiplier ??
          DEFAULT_DOWNLOAD_SETTINGS.backoffMultiplier,
        jitterPercentage:
          config.download?.jitterPercentage ??
          domainConfig?.download?.jitterPercentage ??
          globalDownload?.jitterPercentage ??
          DEFAULT_DOWNLOAD_SETTINGS.jitterPercentage,
      },
    };
  }

  /**
   * Add episodes to the download queue
   *
   * @param seriesUrl - Series URL
   * @param seriesName - Series name
   * @param episodes - Episodes to download
   */
  addEpisodes(seriesUrl: string, seriesName: string, episodes: Episode[]): void {
    if (episodes.length === 0) {
      return;
    }

    const domain = extractDomain(seriesUrl);

    // Register queues for this domain if not already registered
    this.registerDomainQueues(domain);

    // Get download delay from domain config
    const domainConfig = this.getDomainConfig(domain);
    const downloadDelay =
      domainConfig.download?.downloadDelay ??
      this.globalConfigs?.download?.downloadDelay ??
      DEFAULT_DOWNLOAD_SETTINGS.downloadDelay;

    // Add episodes to download queue with staggered delays
    for (let i = 0; i < episodes.length; i++) {
      const episode = episodes[i]!;
      const item: DownloadQueueItem = {
        seriesUrl,
        seriesName,
        episode,
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
   * Check if there is active processing
   *
   * @returns Whether scheduler is actively processing
   */
  hasActiveProcessing(): boolean {
    return this.scheduler.isExecutorBusy();
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

    // Get domain configuration
    const domainConfig = this.getDomainConfig(domain);

    // Get handler for this domain
    const handler = handlerRegistry.getHandlerOrThrow(`https://${domain}/`);
    this.domainHandlers.set(domain, handler);

    // Get cooldowns
    const checkInterval =
      domainConfig.check?.checkInterval ??
      this.globalConfigs?.check?.checkInterval ??
      DEFAULT_CHECK_SETTINGS.checkInterval;
    const downloadDelay =
      domainConfig.download?.downloadDelay ??
      this.globalConfigs?.download?.downloadDelay ??
      DEFAULT_DOWNLOAD_SETTINGS.downloadDelay;

    // Register queues with scheduler
    this.scheduler.registerQueue(checkQueueName, checkInterval * 1000); // Convert to ms
    this.scheduler.registerQueue(downloadQueueName, downloadDelay * 1000); // Convert to ms
  }

  /**
   * Get domain configuration with defaults
   *
   * 3-level hierarchy (highest to lowest priority):
   * 1. Domain config (from domainConfigs)
   * 2. Global defaults (globalConfigs)
   * 3. Hardcoded defaults
   *
   * Note: Series-level config is applied in mergeSeriesConfig()
   *
   * @param domain - Domain name
   * @returns Domain configuration
   */
  private getDomainConfig(domain: string): DomainConfig {
    // Level 3: Domain config
    if (this.domainConfigs.has(domain)) {
      return this.domainConfigs.get(domain) as DomainConfig;
    }

    // Level 2: Global defaults
    if (this.globalConfigs?.check || this.globalConfigs?.download) {
      return {
        domain,
        check: this.globalConfigs.check,
        download: this.globalConfigs.download,
      };
    }

    // Level 1: Hardcoded defaults (fallback)
    return {
      domain,
      check: DEFAULT_CHECK_SETTINGS,
      download: DEFAULT_DOWNLOAD_SETTINGS,
    };
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
    const checksCount = config.check?.count ?? DEFAULT_CHECK_SETTINGS.count;
    const checkInterval = config.check?.checkInterval ?? DEFAULT_CHECK_SETTINGS.checkInterval;

    try {
      // Perform the check
      const result = await this.performCheck(handler, seriesUrl, seriesName, config, attemptNumber, domain);

      if (result.hasNewEpisodes) {
        // Episodes found - send to download queue, do NOT requeue
        this.notifier.notify(
          NotificationLevel.SUCCESS,
          `[${domain}] Found ${result.episodes.length} new episodes for ${seriesName} (attempt ${attemptNumber}/${checksCount})`,
        );

        // Add episodes to download queue
        this.addEpisodes(seriesUrl, seriesName, result.episodes);

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
      const domainConfig = this.getDomainConfig(domain);
      const maxRetries = domainConfig.download?.maxRetries ?? DEFAULT_DOWNLOAD_SETTINGS.maxRetries;
      const initialTimeout = domainConfig.download?.initialTimeout ?? DEFAULT_DOWNLOAD_SETTINGS.initialTimeout;
      const backoffMultiplier = domainConfig.download?.backoffMultiplier ?? DEFAULT_DOWNLOAD_SETTINGS.backoffMultiplier;
      const jitterPercentage = domainConfig.download?.jitterPercentage ?? DEFAULT_DOWNLOAD_SETTINGS.jitterPercentage;

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

        this.scheduler.addTask(queueName, requeuedItem, retryDelay);
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
    const { seriesUrl, seriesName, episode, retryCount = 0 } = item;

    // Get domain config
    const domainConfig = this.getDomainConfig(domain);
    const downloadDelay = domainConfig.download?.downloadDelay ?? DEFAULT_DOWNLOAD_SETTINGS.downloadDelay;

    try {
      // Attempt download
      await this.downloadManager.download(seriesUrl, seriesName, episode);

      // Success - log and continue
      this.notifier.notify(
        NotificationLevel.SUCCESS,
        `[${domain}] Successfully queued download of Episode ${episode.number} for ${seriesName}`,
      );

      this.scheduler.markTaskComplete(queueName, downloadDelay * 1000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if we should retry
      const maxRetries = domainConfig.download?.maxRetries ?? DEFAULT_DOWNLOAD_SETTINGS.maxRetries;
      const initialTimeout = domainConfig.download?.initialTimeout ?? DEFAULT_DOWNLOAD_SETTINGS.initialTimeout;
      const backoffMultiplier = domainConfig.download?.backoffMultiplier ?? DEFAULT_DOWNLOAD_SETTINGS.backoffMultiplier;
      const jitterPercentage = domainConfig.download?.jitterPercentage ?? DEFAULT_DOWNLOAD_SETTINGS.jitterPercentage;

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

        this.scheduler.addTask(queueName, requeuedItem, retryDelay);
        this.scheduler.markTaskComplete(queueName, downloadDelay * 1000);
      } else {
        // Max retries exceeded - log error and give up
        this.notifier.notify(
          NotificationLevel.ERROR,
          `[${domain}] Failed to download Episode ${episode.number} after ${retryCount} attempts: ${errorMessage}`,
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
    config: SeriesConfig,
    attemptNumber: number,
    domain: string,
  ): Promise<{ hasNewEpisodes: boolean; episodes: Episode[]; requeueDelay?: number }> {
    const checksCount = config.check?.count ?? DEFAULT_CHECK_SETTINGS.count;

    this.notifier.notify(
      NotificationLevel.INFO,
      `[${domain}] Checking ${seriesUrl} for new episodes... (attempt ${attemptNumber}/${checksCount})`,
    );

    // Extract episodes from the series page
    const episodes = await handler.extractEpisodes(seriesUrl);

    this.notifier.notify(NotificationLevel.INFO, `[${domain}] Found ${episodes.length} total episodes on ${seriesUrl}`);

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
   * Get episode types to download from config or use defaults
   *
   * @param config - Series configuration
   * @returns Array of episode types
   */
  private getDownloadTypes(config: SeriesConfig): string[] {
    // Get from series config, domain config, or use defaults
    const downloadTypes = config.check?.downloadTypes ?? this.globalConfigs?.check?.downloadTypes;

    return downloadTypes ?? ['available', 'vip'];
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
    this.globalConfigs = globalConfigs;
  }
}
