import type { DownloadManager } from '../downloader/download-manager';
import { SchedulerError } from '../errors/custom-errors';
import type { Notifier } from '../notifications/notifier';
import { NotificationLevel } from '../notifications/notifier';
import type { StateManager } from '../state/state-manager';
import type { SeriesConfig } from '../types/config.types';
import type { DomainHandler } from '../types/handler.types';
import { getMsUntilTime, sleep } from '../utils/time-utils';
import { TaskRunner } from './task-runner';

/**
 * Scheduler for managing periodic checks
 */
export class Scheduler {
  private configs: SeriesConfig[];
  private getHandler: (url: string) => DomainHandler;
  private stateManager: StateManager;
  private downloadManager: DownloadManager;
  private notifier: Notifier;
  private cookies?: string;
  private taskRunners: TaskRunner[] = [];
  private running: boolean = false;
  private stopped: boolean = true;

  constructor(
    configs: SeriesConfig[],
    getHandler: (url: string) => DomainHandler,
    stateManager: StateManager,
    downloadManager: DownloadManager,
    notifier: Notifier,
    cookies?: string,
  ) {
    this.configs = configs;
    this.getHandler = getHandler;
    this.stateManager = stateManager;
    this.downloadManager = downloadManager;
    this.notifier = notifier;
    this.cookies = cookies;
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

    this.notifier.notify(NotificationLevel.INFO, 'Scheduler started');

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
        await sleep(msUntil);
      }

      if (this.stopped) break;

      // Run all tasks for this time group
      await this.runConfigs(configs);
    }

    this.running = false;
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    this.notifier.notify(NotificationLevel.INFO, 'Stopping scheduler...');

    this.stopped = true;

    // Stop all task runners
    for (const runner of this.taskRunners) {
      runner.stop();
    }

    // Wait a bit for tasks to finish
    await sleep(2000);

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
   * Run all configs in parallel
   */
  private async runConfigs(configs: SeriesConfig[]): Promise<void> {
    const runners: TaskRunner[] = [];

    // Create task runners
    for (const config of configs) {
      const handler = this.getHandler(config.url);
      const runner = new TaskRunner(
        config,
        handler,
        this.stateManager,
        this.downloadManager,
        this.notifier,
        this.cookies,
      );
      runners.push(runner);
    }

    this.taskRunners = runners;

    // Run all tasks in parallel
    await Promise.all(runners.map((runner) => runner.runMultipleChecks()));
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.running && !this.stopped;
  }
}
