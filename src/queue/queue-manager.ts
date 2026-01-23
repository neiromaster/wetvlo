/**
 * QueueManager - Orchestrates per-domain check and download queues
 *
 * Manages the queue-based architecture with:
 * - Per-domain check and download queues
 * - Single checker (concatMap across all check queues)
 * - Single downloader (concatMap across all download queues)
 * - Graceful shutdown
 * - Domain-based parallelism
 */

import { DEFAULT_CHECK_SETTINGS, DEFAULT_DOWNLOAD_SETTINGS } from '../config/config-defaults.js';
import type { DownloadManager } from '../downloader/download-manager.js';
import { handlerRegistry } from '../handlers/handler-registry.js';
import type { Notifier } from '../notifications/notifier.js';
import { NotificationLevel } from '../notifications/notifier.js';
import type { StateManager } from '../state/state-manager.js';
import type { GlobalConfigs, SeriesConfig } from '../types/config.types.js';
import type { Episode } from '../types/episode.types.js';
import { extractDomain } from '../utils/url-utils.js';
import { CheckQueue } from './check-queue.js';
import { DownloadQueue } from './download-queue.js';
import { sleep } from './retry-strategy.js';
import type { DomainConfig } from './types.js';

/**
 * Per-domain queue pair
 */
type DomainQueuesPair = {
  checkQueue: CheckQueue;
  downloadQueue: DownloadQueue;
};

/**
 * Queue Manager for orchestrating all queues
 */
export class QueueManager {
  private stateManager: StateManager;
  private downloadManager: DownloadManager;
  private notifier: Notifier;

  // Per-domain queues
  private checkQueues: Map<string, CheckQueue> = new Map();
  private downloadQueues: Map<string, DownloadQueue> = new Map();

  // Domain configurations
  private domainConfigs: Map<string, DomainConfig> = new Map();

  // Global defaults
  private globalConfigs?: GlobalConfigs;

  // Checker and downloader loops
  private checkerRunning = false;
  private downloaderRunning = false;
  private shouldStop = false;

  // Active processing tracking
  private activeChecks = new Set<string>();
  private activeDownloads = new Set<string>();

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

    // Get or create queues for this domain
    const { checkQueue } = this.getOrCreateDomainQueues(domain);

    // Add series to check queue with merged config
    checkQueue.addSeriesCheck(mergedConfig.url, mergedConfig.name, mergedConfig, 1);

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

    // Get or create download queue for this domain
    const { downloadQueue } = this.getOrCreateDomainQueues(domain);

    // Add episodes to download queue
    downloadQueue.addEpisodes(seriesUrl, seriesName, episodes);

    this.notifier.notify(
      NotificationLevel.SUCCESS,
      `[QueueManager] Added ${episodes.length} episodes to download queue for ${seriesName} (domain ${domain})`,
    );
  }

  /**
   * Start all queues
   */
  start(): void {
    if (this.checkerRunning || this.downloaderRunning) {
      throw new Error('QueueManager is already running');
    }

    this.shouldStop = false;
    this.checkerRunning = true;
    this.downloaderRunning = true;

    // Start the checker loop (single checker for all check queues)
    this.runChecker().catch((error) => {
      this.notifier.notify(
        NotificationLevel.ERROR,
        `Checker loop error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    // Start the downloader loop (single downloader for all download queues)
    this.runDownloader().catch((error) => {
      this.notifier.notify(
        NotificationLevel.ERROR,
        `Downloader loop error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    this.notifier.notify(NotificationLevel.INFO, '[QueueManager] Started queue processing');
  }

  /**
   * Stop all queues gracefully
   *
   * Drains all queues before stopping.
   */
  async stop(): Promise<void> {
    if (!this.checkerRunning && !this.downloaderRunning) {
      return;
    }

    this.notifier.notify(NotificationLevel.INFO, '[QueueManager] Stopping queue processing...');

    this.shouldStop = true;

    // Stop all check queues
    const checkStopPromises = Array.from(this.checkQueues.values()).map((queue) => queue.stop());
    await Promise.all(checkStopPromises);

    // Stop all download queues
    const downloadStopPromises = Array.from(this.downloadQueues.values()).map((queue) => queue.stop());
    await Promise.all(downloadStopPromises);

    this.checkerRunning = false;
    this.downloaderRunning = false;

    this.notifier.notify(NotificationLevel.INFO, '[QueueManager] Queue processing stopped');
  }

  /**
   * Check if there is active processing
   *
   * @returns Whether any queue is actively processing
   */
  hasActiveProcessing(): boolean {
    // Check if any queue is processing
    for (const queue of this.checkQueues.values()) {
      if (queue.isProcessing()) {
        return true;
      }
    }

    for (const queue of this.downloadQueues.values()) {
      if (queue.isProcessing()) {
        return true;
      }
    }

    return false;
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
    const checkQueues: Record<string, { length: number; processing: boolean }> = {};
    const downloadQueues: Record<string, { length: number; processing: boolean }> = {};

    for (const [domain, queue] of this.checkQueues.entries()) {
      checkQueues[domain] = {
        length: queue.getQueueLength(),
        processing: queue.isProcessing(),
      };
    }

    for (const [domain, queue] of this.downloadQueues.entries()) {
      downloadQueues[domain] = {
        length: queue.getQueueLength(),
        processing: queue.isProcessing(),
      };
    }

    return { checkQueues, downloadQueues };
  }

  /**
   * Get or create domain queues
   *
   * @param domain - Domain name
   * @returns Domain queue pair
   */
  private getOrCreateDomainQueues(domain: string): DomainQueuesPair {
    // Return existing queues if already created
    if (this.checkQueues.has(domain) && this.downloadQueues.has(domain)) {
      return {
        checkQueue: this.checkQueues.get(domain) as CheckQueue,
        downloadQueue: this.downloadQueues.get(domain) as DownloadQueue,
      };
    }

    // Get domain configuration
    const domainConfig = this.getDomainConfig(domain);

    // Get handler for this domain
    const handler = handlerRegistry.getHandlerOrThrow(`https://${domain}/`);

    // Create check queue
    const checkQueue = new CheckQueue(
      domain,
      domainConfig,
      handler,
      this.stateManager,
      this.notifier,
      (seriesUrl, seriesName, episodes) => {
        // Callback when episodes are found - add to download queue
        this.addEpisodes(seriesUrl, seriesName, episodes);
      },
    );

    // Create download queue
    const downloadQueue = new DownloadQueue(domain, domainConfig, this.downloadManager, this.notifier);

    // Store queues
    this.checkQueues.set(domain, checkQueue);
    this.downloadQueues.set(domain, downloadQueue);

    return { checkQueue, downloadQueue };
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
   * Run the checker loop
   *
   * Processes items from all check queues sequentially (concatMap).
   */
  private async runChecker(): Promise<void> {
    this.notifier.notify(NotificationLevel.INFO, '[QueueManager] Checker loop started');

    while (!this.shouldStop) {
      // Check if any check queue has items
      let hasItems = false;

      for (const [_domain, queue] of this.checkQueues.entries()) {
        if (queue.getQueueLength() > 0) {
          hasItems = true;
          break;
        }
      }

      if (!hasItems) {
        // No items to process, wait a bit
        // biome-ignore lint/performance/noAwaitInLoops: Sequential polling is intentional
        await sleep(100);
        continue;
      }

      // Process one item from each domain round-robin
      for (const [domain, queue] of this.checkQueues.entries()) {
        if (this.shouldStop) break;

        // Queue processes items automatically via AsyncQueue
        // Just wait a bit between domains to avoid overwhelming
        if (queue.isProcessing()) {
          this.activeChecks.add(domain);
        } else {
          this.activeChecks.delete(domain);
        }
      }

      await sleep(50);
    }

    this.notifier.notify(NotificationLevel.INFO, '[QueueManager] Checker loop stopped');
  }

  /**
   * Run the downloader loop
   *
   * Processes items from all download queues sequentially (concatMap).
   */
  private async runDownloader(): Promise<void> {
    this.notifier.notify(NotificationLevel.INFO, '[QueueManager] Downloader loop started');

    while (!this.shouldStop) {
      // Check if any download queue has items
      let hasItems = false;

      for (const [_domain, queue] of this.downloadQueues.entries()) {
        if (queue.getQueueLength() > 0) {
          hasItems = true;
          break;
        }
      }

      if (!hasItems) {
        // No items to process, wait a bit
        // biome-ignore lint/performance/noAwaitInLoops: Sequential polling is intentional
        await sleep(100);
        continue;
      }

      // Process one item from each domain round-robin
      for (const [domain, queue] of this.downloadQueues.entries()) {
        if (this.shouldStop) break;

        // Queue processes items automatically via AsyncQueue
        // Just wait a bit between domains to avoid overwhelming
        if (queue.isProcessing()) {
          this.activeDownloads.add(domain);
        } else {
          this.activeDownloads.delete(domain);
        }
      }

      await sleep(50);
    }

    this.notifier.notify(NotificationLevel.INFO, '[QueueManager] Downloader loop stopped');
  }

  /**
   * Set global configs (for dependency injection)
   */
  setGlobalConfigs(globalConfigs: GlobalConfigs): void {
    this.globalConfigs = globalConfigs;
  }
}
