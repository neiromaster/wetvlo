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

import { AppContext } from '../app-context';
import type { SeriesConfig } from '../config/config-schema';
import type { DownloadManager } from '../downloader/download-manager';
import { SchedulerError } from '../errors/custom-errors';
import { NotificationLevel } from '../notifications/notifier';
import { QueueManager } from '../queue/queue-manager';
import type { SchedulerOptions } from '../types/config.types';
import { logger } from '../utils/logger';
import { getMsUntilCron, getMsUntilTime, sleep } from '../utils/time-utils';

/**
 * Time provider type for dependency injection
 */
export type TimeProvider = {
  getMsUntilTime: typeof getMsUntilTime;
  getMsUntilCron: typeof getMsUntilCron;
  sleep: typeof sleep;
};

/**
 * QueueManager factory type for dependency injection
 */
export type QueueManagerFactory = (downloadManager: DownloadManager) => QueueManager;

/**
 * Scheduler for managing periodic checks with queue-based architecture
 */
export class Scheduler {
  private configs: SeriesConfig[];
  private downloadManager: DownloadManager;
  private options: SchedulerOptions;
  private queueManager: QueueManager;
  private running: boolean = false;
  private stopped: boolean = true;
  private timeProvider: TimeProvider;
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    configs: SeriesConfig[],
    downloadManager: DownloadManager,
    options: SchedulerOptions = { mode: 'scheduled' },
    timeProvider?: TimeProvider,
    queueManagerFactory?: QueueManagerFactory,
  ) {
    this.configs = configs;
    this.downloadManager = downloadManager;
    this.options = options;
    this.timeProvider = timeProvider || { getMsUntilTime, getMsUntilCron, sleep };

    // Create queue manager
    const createQueueManager = queueManagerFactory || ((dm) => new QueueManager(dm));

    this.queueManager = createQueueManager(this.downloadManager);
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

    const notifier = AppContext.getNotifier();

    if (this.options.mode === 'once') {
      logger.debug('Single-run mode: checking all series once');
      await this.runOnce();
      this.running = false;
    } else {
      notifier.notify(NotificationLevel.INFO, 'Scheduler started');
      this.scheduleNextBatch();

      // Keep promise pending forever for scheduled mode to prevent process exit
      // In a real app, this is handled by the event loop being active (timers/intervals)
      // but runApp awaits start(), so we return a promise that only resolves on stop()
      return new Promise<void>((resolve) => {
        const checkStop = setInterval(() => {
          if (!this.running) {
            clearInterval(checkStop);
            resolve();
          }
        }, 100);
      });
    }
  }

  private scheduleNextBatch(): void {
    if (this.stopped) return;

    const notifier = AppContext.getNotifier();
    const groupedConfigs = this.groupConfigsBySchedule();
    let nextScheduleKey: string | null = null;
    let minMsUntil = Number.MAX_SAFE_INTEGER;

    for (const scheduleKey of groupedConfigs.keys()) {
      let msUntil: number;

      try {
        // Determine if it's HH:MM or cron
        if (/^\d{1,2}:\d{2}$/.test(scheduleKey)) {
          msUntil = this.timeProvider.getMsUntilTime(scheduleKey);
        } else {
          // Assume cron
          msUntil = this.timeProvider.getMsUntilCron(scheduleKey);
        }

        if (msUntil < minMsUntil) {
          minMsUntil = msUntil;
          nextScheduleKey = scheduleKey;
        }
      } catch (error) {
        notifier.notify(
          NotificationLevel.ERROR,
          `Error calculating next run time for schedule "${scheduleKey}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (!nextScheduleKey) {
      notifier.notify(NotificationLevel.WARNING, 'No scheduled configs found.');
      return;
    }

    const configs = groupedConfigs.get(nextScheduleKey);
    if (!configs) return;

    if (minMsUntil > 0) {
      this.options.onIdle?.();
      notifier.notify(NotificationLevel.INFO, `Next run: ${nextScheduleKey} in ${Math.floor(minMsUntil / 1000 / 60)}m`);
    }

    // Schedule next run
    this.scheduleTimer = setTimeout(async () => {
      if (this.stopped) return;
      await this.runConfigs(configs);
      await this.waitForQueueDrain();
      this.scheduleNextBatch();
    }, minMsUntil);
  }

  /**
   * Wait for all queues to drain
   */
  private async waitForQueueDrain(): Promise<void> {
    while (this.queueManager.hasActiveProcessing()) {
      if (this.stopped) break;
      // biome-ignore lint/performance/noAwaitInLoops: Sequential polling is intentional
      await this.timeProvider.sleep(1000);
    }
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    logger.debug('Stopping scheduler...');

    this.stopped = true;
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    // Stop queue manager (drains all queues)
    await this.queueManager.stop();

    this.running = false;

    logger.debug('Scheduler stopped');
  }

  /**
   * Reload configuration
   */
  async reload(configs: SeriesConfig[]): Promise<void> {
    logger.debug('Reloading configuration...');

    // Update internal state
    this.configs = configs;

    // Update queue manager config (reloads from AppContext)
    this.queueManager.updateConfig();

    // If running in scheduled mode, restart the schedule
    if (this.running && this.options.mode === 'scheduled') {
      if (this.scheduleTimer) {
        clearTimeout(this.scheduleTimer);
        this.scheduleTimer = null;
      }
      this.scheduleNextBatch();
    }
  }

  /**
   * Update the download manager instance
   * Used during config reload when download settings change
   */
  updateDownloadManager(downloadManager: DownloadManager): void {
    this.downloadManager = downloadManager;
    // QueueManager gets DownloadManager through AppContext, no need to update
  }

  /**
   * Trigger immediate checks for all series
   */
  async triggerAllChecks(): Promise<void> {
    logger.debug('Triggering immediate checks for all series...');
    for (const config of this.configs) {
      this.queueManager.addSeriesCheck(config.url);
    }
  }

  clearQueues(): void {
    logger.debug('Clearing queues...');
    this.queueManager.clearQueues();
  }

  /**
   * Group configs by schedule (startTime or cron)
   */
  private groupConfigsBySchedule(): Map<string, SeriesConfig[]> {
    const notifier = AppContext.getNotifier();
    const grouped = new Map<string, SeriesConfig[]>();

    for (const config of this.configs) {
      const scheduleKey = config.cron || config.startTime;
      if (!scheduleKey) {
        notifier.notify(NotificationLevel.WARNING, `Skip ${config.name}: no schedule`);
        continue;
      }

      const existing = grouped.get(scheduleKey) || [];
      existing.push(config);
      grouped.set(scheduleKey, existing);
    }

    return grouped;
  }

  /**
   * Add all configs to queue manager
   */
  private async runConfigs(configs: SeriesConfig[]): Promise<void> {
    const notifier = AppContext.getNotifier();

    // Add all series to the queue manager
    for (const config of configs) {
      if (this.stopped) break;

      this.queueManager.addSeriesCheck(config.url);
    }

    // Log queue stats
    const stats = this.queueManager.getQueueStats();
    logger.debug(`Queue stats: ${JSON.stringify(stats)}`);
    notifier.notify(NotificationLevel.INFO, `Added ${configs.length} series to queue`);
  }

  /**
   * Run all configs in single-run mode
   */
  private async runOnce(): Promise<void> {
    for (const config of this.configs) {
      if (this.stopped) break;

      this.queueManager.addSeriesCheck(config.url);
    }

    // Wait for all queues to drain
    while (this.queueManager.hasActiveProcessing()) {
      if (this.stopped) break;
      // biome-ignore lint/performance/noAwaitInLoops: Sequential polling is intentional
      await this.timeProvider.sleep(1000);
    }

    logger.debug('Single-run complete');
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
