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
import type { DomainConfig, GlobalConfigs, SchedulerOptions, SeriesConfig } from '../types/config.types.js';
import { getMsUntilCron, getMsUntilTime, sleep } from '../utils/time-utils.js';

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
export type QueueManagerFactory = (
  stateManager: StateManager,
  downloadManager: DownloadManager,
  notifier: Notifier,
  cookies: string | undefined,
  domainConfigs: DomainConfig[] | undefined,
  globalConfigs: GlobalConfigs | undefined,
) => QueueManager;

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
  private globalConfigs?: GlobalConfigs;
  private domainConfigs?: DomainConfig[];
  private timeProvider: TimeProvider;
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    configs: SeriesConfig[],
    stateManager: StateManager,
    downloadManager: DownloadManager,
    notifier: Notifier,
    cookies?: string,
    options: SchedulerOptions = { mode: 'scheduled' },
    globalConfigs?: GlobalConfigs,
    domainConfigs?: DomainConfig[],
    timeProvider?: TimeProvider,
    queueManagerFactory?: QueueManagerFactory,
  ) {
    this.configs = configs;
    this.stateManager = stateManager;
    this.downloadManager = downloadManager;
    this.notifier = notifier;
    this.cookies = cookies;
    this.options = options;
    this.globalConfigs = globalConfigs;
    this.domainConfigs = domainConfigs;
    this.timeProvider = timeProvider || { getMsUntilTime, getMsUntilCron, sleep };

    // Create queue manager
    const createQueueManager =
      queueManagerFactory ||
      ((sm, dm, notif, cook, dConf, gConf) => new QueueManager(sm, dm, notif, cook, dConf, gConf));

    this.queueManager = createQueueManager(
      this.stateManager,
      this.downloadManager,
      this.notifier,
      this.cookies,
      this.domainConfigs,
      this.globalConfigs,
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
      this.running = false;
    } else {
      this.notifier.notify(NotificationLevel.INFO, 'Scheduler started (queue-based architecture)');
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
        this.notifier.notify(
          NotificationLevel.ERROR,
          `Error calculating next run time for schedule "${scheduleKey}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (!nextScheduleKey) {
      this.notifier.notify(NotificationLevel.WARNING, 'No scheduled configs found.');
      return;
    }

    const configs = groupedConfigs.get(nextScheduleKey);
    if (!configs) return;

    if (minMsUntil > 0) {
      this.options.onIdle?.();
      this.notifier.notify(
        NotificationLevel.INFO,
        `Waiting ${Math.floor(minMsUntil / 1000 / 60)} minutes until next run (${nextScheduleKey})...`,
      );
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
    this.notifier.notify(NotificationLevel.INFO, 'Stopping scheduler...');

    this.stopped = true;
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    // Stop queue manager (drains all queues)
    await this.queueManager.stop();

    // Save state
    await this.stateManager.save();

    this.running = false;

    this.notifier.notify(NotificationLevel.INFO, 'Scheduler stopped');
  }

  /**
   * Reload configuration
   */
  async reload(configs: SeriesConfig[], globalConfigs?: GlobalConfigs, domainConfigs?: DomainConfig[]): Promise<void> {
    this.notifier.notify(NotificationLevel.INFO, 'Reloading configuration...');

    // Update internal state
    this.configs = configs;
    this.globalConfigs = globalConfigs;
    this.domainConfigs = domainConfigs;

    // Update queue manager config
    this.queueManager.updateConfig(domainConfigs, globalConfigs);

    // If running in scheduled mode, restart the schedule
    if (this.running && this.options.mode === 'scheduled') {
      if (this.scheduleTimer) {
        clearTimeout(this.scheduleTimer);
        this.scheduleTimer = null;
      }
      this.scheduleNextBatch();
    }

    this.notifier.notify(NotificationLevel.SUCCESS, 'Configuration reloaded');
  }

  /**
   * Trigger immediate checks for all series
   */
  async triggerAllChecks(): Promise<void> {
    this.notifier.notify(NotificationLevel.INFO, 'Triggering immediate checks for all series...');
    for (const config of this.configs) {
      this.queueManager.addSeriesCheck(config);
    }
  }

  /**
   * Group configs by schedule (startTime or cron)
   */
  private groupConfigsBySchedule(): Map<string, SeriesConfig[]> {
    const grouped = new Map<string, SeriesConfig[]>();

    for (const config of this.configs) {
      const scheduleKey = config.cron || config.startTime;
      if (!scheduleKey) {
        this.notifier.notify(
          NotificationLevel.WARNING,
          `Series "${config.name}" has no startTime or cron configured. Skipping.`,
        );
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
      await this.timeProvider.sleep(1000);
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
