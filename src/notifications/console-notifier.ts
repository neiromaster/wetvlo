import { logger } from '../utils/logger';
import type { Notifier } from './notifier';
import { NotificationLevel } from './notifier';

/**
 * Console notifier for terminal output
 */
export class ConsoleNotifier implements Notifier {
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
}
