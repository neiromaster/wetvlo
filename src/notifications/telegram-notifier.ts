import { NotificationError } from '../errors/custom-errors';
import { LEVEL_PRIORITIES, NotificationLevel } from './notification-level';
import type { Notifier } from './notifier';

/**
 * Telegram configuration
 */
export type TelegramConfig = {
  botToken: string;
  chatId: string;
  minLevel?: NotificationLevel;
};

/**
 * Telegram notifier with configurable minimum level
 */
export class TelegramNotifier implements Notifier {
  private config: TelegramConfig;
  private apiUrl: string;

  constructor(config: TelegramConfig) {
    this.config = config;
    this.apiUrl = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  }

  /**
   * Check if notification should be sent based on level priority
   */
  private shouldNotify(level: NotificationLevel): boolean {
    const minLevel = this.config.minLevel ?? NotificationLevel.ERROR;
    return LEVEL_PRIORITIES[level] >= LEVEL_PRIORITIES[minLevel];
  }

  /**
   * Send notification via Telegram
   * Only sends notifications at or above minLevel
   */
  async notify(level: NotificationLevel, message: string): Promise<void> {
    // Skip if level is below minimum
    if (!this.shouldNotify(level)) {
      return;
    }

    try {
      const emoji = this.getEmoji(level);
      // Truncate message if it's too long (Telegram limit is 4096 chars)
      // We reserve ~100 chars for header and tags
      const MAX_LENGTH = 4000;
      let safeMessage = message;
      if (safeMessage.length > MAX_LENGTH) {
        safeMessage = `${safeMessage.substring(0, MAX_LENGTH)}\n... (truncated)`;
      }

      // Escape HTML characters in the message to prevent parsing errors
      const escapedMessage = this.escapeHtml(safeMessage);
      // Use <pre> tag for the error message to preserve formatting and monospacing
      const formattedMessage = `${emoji} <b>wetvlo ${this.getLevelLabel(level)}</b>\n\n<pre>${escapedMessage}</pre>`;

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text: formattedMessage,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new NotificationError(
          `Failed to send Telegram notification: ${response.status} ${response.statusText}\n${errorText}`,
        );
      }
    } catch (error) {
      // Don't throw for notification errors, just log them
      console.error('Telegram notification failed:', error);
    }
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Get emoji for notification level
   */
  private getEmoji(level: NotificationLevel): string {
    switch (level) {
      case NotificationLevel.DEBUG:
        return '🔍';
      case NotificationLevel.INFO:
        return 'ℹ️';
      case NotificationLevel.SUCCESS:
        return '✅';
      case NotificationLevel.WARNING:
        return '⚠️';
      case NotificationLevel.ERROR:
        return '❌';
      case NotificationLevel.HIGHLIGHT:
        return '🔔';
      default:
        return '';
    }
  }

  /**
   * Get label for notification level
   */
  private getLevelLabel(level: NotificationLevel): string {
    switch (level) {
      case NotificationLevel.DEBUG:
        return 'Debug';
      case NotificationLevel.INFO:
        return 'Info';
      case NotificationLevel.SUCCESS:
        return 'Success';
      case NotificationLevel.WARNING:
        return 'Warning';
      case NotificationLevel.ERROR:
        return 'Error';
      case NotificationLevel.HIGHLIGHT:
        return 'Notification';
      default:
        return 'Message';
    }
  }

  /**
   * Progress updates are not sent to Telegram (no-op)
   */
  async progress(_message: string): Promise<void> {
    // Telegram doesn't need real-time progress updates
  }

  /**
   * Progress finalization is no-op for Telegram
   */
  async endProgress(): Promise<void> {
    // No-op for Telegram
  }
}
