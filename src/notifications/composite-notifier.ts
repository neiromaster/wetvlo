import type { NotificationLevel } from './notification-level';
import type { Notifier } from './notifier';

/**
 * Composite notifier that broadcasts to multiple registered notifiers
 * Notifies can be added with priority (higher = called first)
 */
export class CompositeNotifier implements Notifier {
  private notifiers: Array<{ notifier: Notifier; priority: number }> = [];

  /**
   * Add an external notifier
   * @param notifier - Notifier instance to add
   * @param priority - Priority (higher = called first). Default: 0
   */
  add(notifier: Notifier, priority: number = 0): void {
    this.notifiers.push({ notifier, priority });
    this.sort();
  }

  /**
   * Remove a notifier
   * @param notifier - Notifier instance to remove
   */
  remove(notifier: Notifier): void {
    this.notifiers = this.notifiers.filter((n) => n.notifier !== notifier);
  }

  /**
   * Sort notifiers by priority (highest first)
   */
  private sort(): void {
    this.notifiers.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Send notification to all registered notifiers
   */
  async notify(level: NotificationLevel, message: string): Promise<void> {
    await Promise.all(
      this.notifiers.map(async ({ notifier }) => {
        try {
          await notifier.notify(level, message);
        } catch (error) {
          // Log error but don't break other notifiers
          console.error(`Notifier error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
  }

  /**
   * Update progress on all notifiers
   */
  progress(message: string): void {
    for (const { notifier } of this.notifiers) {
      try {
        notifier.progress(message);
      } catch (error) {
        console.error(`Progress error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * End progress on all notifiers
   */
  endProgress(): void {
    for (const { notifier } of this.notifiers) {
      try {
        notifier.endProgress();
      } catch (error) {
        console.error(`End progress error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
