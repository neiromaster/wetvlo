import { logger } from '../utils/logger';
import { LEVEL_PRIORITIES, NotificationLevel } from './notification-level';
import type { Notifier } from './notifier';

/**
 * Async queue for non-blocking console operations
 */
class ConsoleQueue {
  private queue: Array<() => void> = [];
  private processing = false;

  add(fn: () => void): void {
    this.queue.push(fn);
    if (!this.processing) {
      this.process();
    }
  }

  private process(): void {
    this.processing = true;
    // Use setImmediate to defer processing until next event loop tick
    setImmediate(() => {
      const fn = this.queue.shift();
      if (fn) {
        fn();
      }
      if (this.queue.length > 0) {
        this.process();
      } else {
        this.processing = false;
      }
    });
  }
}

/**
 * Console notifier for terminal output with configurable minimum level
 *
 * Uses non-blocking async operations to prevent slowing down the main event loop.
 * All console operations are deferred to the next tick.
 */
export class ConsoleNotifier implements Notifier {
  private lastProgressLength = 0;
  private minLevel: NotificationLevel;
  private queue: ConsoleQueue;

  constructor(minLevel: NotificationLevel = NotificationLevel.INFO) {
    this.minLevel = minLevel;
    this.queue = new ConsoleQueue();
  }

  /**
   * Check if notification should be sent based on level priority
   */
  private shouldNotify(level: NotificationLevel): boolean {
    return LEVEL_PRIORITIES[level] >= LEVEL_PRIORITIES[this.minLevel];
  }

  /**
   * Send notification (non-blocking)
   *
   * Operations are deferred to avoid blocking the main thread.
   */
  async notify(level: NotificationLevel, message: string): Promise<void> {
    // Skip if level is below minimum
    if (!this.shouldNotify(level)) {
      return;
    }

    // Queue the notification for async processing
    this.queue.add(() => {
      // If there was an active progress line, clear it first so the log appears cleanly
      if (this.lastProgressLength > 0) {
        process.stdout.write(`\r${' '.repeat(this.lastProgressLength)}\r`);
        this.lastProgressLength = 0;
      }

      switch (level) {
        case NotificationLevel.DEBUG:
          logger.debug(message);
          break;
        case NotificationLevel.INFO:
          logger.info(message);
          break;
        case NotificationLevel.SUCCESS:
          logger.success(message);
          break;
        case NotificationLevel.WARNING:
          logger.warning(message);
          break;
        case NotificationLevel.ERROR:
          logger.error(message);
          break;
        case NotificationLevel.HIGHLIGHT:
          logger.highlight(message);
          break;
      }
    });
  }

  /**
   * Update progress (non-blocking)
   *
   * Progress updates are fire-and-forget to avoid blocking downloads.
   */
  progress(message: string): void {
    // Queue the progress update
    this.queue.add(() => {
      // Clear previous progress by overwriting with spaces
      if (this.lastProgressLength > 0) {
        process.stdout.write(`\r${' '.repeat(this.lastProgressLength)}\r`);
      }

      // Write new progress message
      process.stdout.write(`\r${message}`);
      this.lastProgressLength = message.length;
    });
  }

  /**
   * Finalize progress (non-blocking)
   *
   * Adds a newline after the last progress update.
   */
  endProgress(): void {
    // Queue the end progress operation
    this.queue.add(() => {
      if (this.lastProgressLength > 0) {
        process.stdout.write('\n');
        this.lastProgressLength = 0;
      }
    });
  }
}
