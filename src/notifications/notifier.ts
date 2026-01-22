/**
 * Notification levels
 */
export enum NotificationLevel {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
}

/**
 * Notifier interface for sending notifications
 */
export type Notifier = {
  /**
   * Send a notification
   * @param level - Notification level
   * @param message - Message to send
   */
  notify(level: NotificationLevel, message: string): Promise<void> | void;
};
