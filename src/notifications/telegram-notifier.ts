import { NotificationError } from '../errors/custom-errors';
import type { Notifier } from './notifier';
import { NotificationLevel } from './notifier';

/**
 * Telegram configuration
 */
export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

/**
 * Telegram notifier for error notifications only
 */
export class TelegramNotifier implements Notifier {
  private config: TelegramConfig;
  private apiUrl: string;

  constructor(config: TelegramConfig) {
    this.config = config;
    this.apiUrl = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  }

  /**
   * Send notification via Telegram
   * Only sends ERROR level notifications
   */
  async notify(level: NotificationLevel, message: string): Promise<void> {
    // Only send error notifications
    if (level !== NotificationLevel.ERROR) {
      return;
    }

    try {
      const emoji = this.getEmoji(level);
      const formattedMessage = `${emoji} *wetvlo Error*\n\n${message}`;

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text: formattedMessage,
          parse_mode: 'Markdown',
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
   * Get emoji for notification level
   */
  private getEmoji(level: NotificationLevel): string {
    switch (level) {
      case NotificationLevel.INFO:
        return 'ℹ️';
      case NotificationLevel.SUCCESS:
        return '✅';
      case NotificationLevel.WARNING:
        return '⚠️';
      case NotificationLevel.ERROR:
        return '❌';
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
