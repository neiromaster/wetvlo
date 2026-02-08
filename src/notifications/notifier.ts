import type { NotificationLevel } from './notification-level';

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

  /**
   * Update progress on the same line (overwrites previous output)
   * @param message - Progress message to display
   */
  progress(message: string): Promise<void> | void;

  /**
   * Finalize progress (add newline after last progress update)
   */
  endProgress(): Promise<void> | void;
};
