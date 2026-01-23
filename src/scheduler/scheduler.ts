/**
 * Scheduler - Queue-based architecture for managing series checks
 *
 * Features:
 * - Per-domain sequential processing (concatMap semantics)
 * - Domain-based parallelism
 * - Retry with exponential backoff
 * - "No episodes" requeue with interval
 * - Graceful shutdown
 */

import type { DownloadManager } from '../downloader/download-manager.js';
import { SchedulerError } from '../errors/custom-errors.js';
import type { Notifier } from '../notifications/notifier.js';
import { NotificationLevel } from '../notifications/notifier.js';
import { QueueManager } from '../queue/queue-manager.js';
import type { StateManager } from '../state/state-manager.js';
import type {
  DomainConfig,
  RetryConfig,
  SchedulerOptions,
  SeriesConfig,
  SeriesDefaults,
} from '../types/config.types.js';
import { getMsUntilTime, sleep } from '../utils/time-utils.js';

/**
 * Scheduler for managing periodic checks with queue-based architecture
 */
export class Scheduler {
  private configs: SeriesConfig[];
  private stateManager: StateManager;
  private downloadManager: DownloadManager;
  private notifier: Notifier;
  private cookies?: string;
  private options: SchedulerOptions;
  private queueManager: QueueManager;
  private running: boolean = false;
  private stopped: boolean = true;
  private domainConfigs?: DomainConfig[];
  private seriesDefaults?: SeriesDefaults;
  private retryDefaults?: RetryConfig;

  constructor(
    configs: SeriesConfig[],
    stateManager: StateManager,
    downloadManager: DownloadManager,
    notifier: Notifier,
    cookies?: string,
    options: SchedulerOptions = { mode: 'scheduled' },
    domainConfigs?: DomainConfig[],
    seriesDefaults?: SeriesDefaults,
    retryDefaults?: RetryConfig,
  ) {
    this.configs = configs;
    this.stateManager = stateManager;
    this.downloadManager = downloadManager;
    this.notifier = notifier;
    this.cookies = cookies;
    this.options = options;
    this.domainConfigs = domainConfigs;
    this.seriesDefaults = seriesDefaults;
    this.retryDefaults = retryDefaults;

    // Create queue manager
    this.queueManager = new QueueManager(
      this.stateManager,
      this.downloadManager,
      this.notifier,
      this.cookies,
      this.domainConfigs,
      this.seriesDefaults,
      this.retryDefaults,
    );
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new SchedulerError('Scheduler is already running');
    }

    this.running = true;
    this.stopped = false;

    // Start queue manager
    this.queueManager.start();

    if (this.options.mode === 'once') {
      this.notifier.notify(NotificationLevel.INFO, 'Single-run mode: checking all series once');
      await this.runOnce();
    } else {
      this.notifier.notify(NotificationLevel.INFO, 'Scheduler started (queue-based architecture)');
      // Group configs by start time
      const groupedConfigs = this.groupConfigsByStartTime();

      // Process each time group
      for (const [startTime, configs] of groupedConfigs.entries()) {
        if (this.stopped) break;

        // Wait until start time
        const msUntil = getMsUntilTime(startTime);
        if (msUntil > 0) {
          this.notifier.notify(
            NotificationLevel.INFO,
            `Waiting ${Math.floor(msUntil / 1000 / 60)} minutes until ${startTime}...`,
          );
          // biome-ignore lint/performance/noAwaitInLoops: Sequential waiting is intentional
          await sleep(msUntil);
        }

        if (this.stopped) break;

        // Add all configs to queue manager
        await this.runConfigs(configs);

        // Wait for queues to drain (optional - can remove if not needed)
        while (this.queueManager.hasActiveProcessing()) {
          if (this.stopped) break;
          // biome-ignore lint/performance/noAwaitInLoops: Sequential polling is intentional
          await sleep(1000);
        }
      }
    }

    this.running = false;
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    this.notifier.notify(NotificationLevel.INFO, 'Stopping scheduler...');

    this.stopped = true;

    // Stop queue manager (drains all queues)
    await this.queueManager.stop();

    // Save state
    await this.stateManager.save();

    this.running = false;

    this.notifier.notify(NotificationLevel.INFO, 'Scheduler stopped');
  }

  /**
   * Group configs by start time
   */
  private groupConfigsByStartTime(): Map<string, SeriesConfig[]> {
    const grouped = new Map<string, SeriesConfig[]>();

    for (const config of this.configs) {
      const existing = grouped.get(config.startTime) || [];
      existing.push(config);
      grouped.set(config.startTime, existing);
    }

    return grouped;
  }

  /**
   * Add all configs to queue manager
   */
  private async runConfigs(configs: SeriesConfig[]): Promise<void> {
    // Add all series to the queue manager
    for (const config of configs) {
      if (this.stopped) break;

      this.queueManager.addSeriesCheck(config);
    }

    // Log queue stats
    const stats = this.queueManager.getQueueStats();
    this.notifier.notify(
      NotificationLevel.INFO,
      `Added ${configs.length} series to check queues. Queue stats: ${JSON.stringify(stats)}`,
    );
  }

  /**
   * Run all configs in single-run mode
   */
  private async runOnce(): Promise<void> {
    for (const config of this.configs) {
      if (this.stopped) break;

      this.queueManager.addSeriesCheck(config);
    }

    // Wait for all queues to drain
    while (this.queueManager.hasActiveProcessing()) {
      if (this.stopped) break;
      // biome-ignore lint/performance/noAwaitInLoops: Sequential polling is intentional
      await sleep(1000);
    }

    // Save state after all checks
    await this.stateManager.save();
    this.notifier.notify(NotificationLevel.SUCCESS, 'Single-run complete');
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.running && !this.stopped;
  }

  /**
   * Get queue manager (for testing/debugging)
   */
  getQueueManager(): QueueManager {
    return this.queueManager;
  }
}
