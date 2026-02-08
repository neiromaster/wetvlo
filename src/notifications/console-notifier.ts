import { logger } from '../utils/logger';
import { LEVEL_PRIORITIES, NotificationLevel } from './notification-level';
import type { Notifier } from './notifier';

/**
 * Console notifier for terminal output with configurable minimum level
 */
export class ConsoleNotifier implements Notifier {
  private lastProgressLength = 0;
  private minLevel: NotificationLevel;

  constructor(minLevel: NotificationLevel = NotificationLevel.INFO) {
    this.minLevel = minLevel;
  }

  /**
   * Check if notification should be sent based on level priority
   */
  private shouldNotify(level: NotificationLevel): boolean {
    return LEVEL_PRIORITIES[level] >= LEVEL_PRIORITIES[this.minLevel];
  }

  notify(level: NotificationLevel, message: string): void {
    // Skip if level is below minimum
    if (!this.shouldNotify(level)) {
      return;
    }

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
  }

  progress(message: string): void {
    // Clear previous progress by overwriting with spaces
    if (this.lastProgressLength > 0) {
      process.stdout.write(`\r${' '.repeat(this.lastProgressLength)}\r`);
    }

    // Write new progress message
    process.stdout.write(`\r${message}`);
    this.lastProgressLength = message.length;
  }

  /**
   * Finalize progress (add newline after last progress update)
   */
  endProgress(): void {
    if (this.lastProgressLength > 0) {
      process.stdout.write('\n');
      this.lastProgressLength = 0;
    }
  }
}
