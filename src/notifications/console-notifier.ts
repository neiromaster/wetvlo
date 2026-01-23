import { logger } from '../utils/logger';
import type { Notifier } from './notifier';
import { NotificationLevel } from './notifier';

/**
 * Console notifier for terminal output
 */
export class ConsoleNotifier implements Notifier {
  private lastProgressLength = 0;

  notify(level: NotificationLevel, message: string): void {
    switch (level) {
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
    }
  }

  progress(message: string): void {
    // Clear previous progress by overwriting with spaces
    if (this.lastProgressLength > 0) {
      process.stdout.write('\r' + ' '.repeat(this.lastProgressLength) + '\r');
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
