/**
 * Event-driven notifier that subscribes to EventBus and forwards notifications
 *
 * This bridges the event system with the existing notifier interface.
 * Components emit events instead of calling notifiers directly.
 */

import type { EventBus } from '../events/event-bus.js';
import type { NotificationLevel } from './notification-level.js';
import type { Notifier } from './notifier.js';

// ============================================================================
// EventNotifier
// ============================================================================

/**
 * EventNotifier subscribes to events and forwards them to an underlying notifier
 *
 * This decouples components from the notifier implementation - they emit events
 * instead of calling notifier methods directly.
 */
export class EventNotifier implements Notifier {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private eventBus: EventBus,
    private underlyingNotifier: Notifier,
  ) {}

  /**
   * Start listening to events
   *
   * Call this during app initialization to begin handling notification events.
   */
  start(): void {
    if (this.unsubscribe) {
      // Already started
      return;
    }

    // Subscribe to notification events
    this.unsubscribe = this.eventBus.onMany({
      'notification:send': async (event) => {
        await this.handleNotificationSend(event);
      },
      'download:progress': async (event) => {
        await this.handleDownloadProgress(event);
      },
    });
  }

  /**
   * Stop listening to events
   *
   * Call this during app shutdown.
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Handle notification:send event
   */
  private async handleNotificationSend(event: {
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
    data?: unknown;
  }): Promise<void> {
    const { type, message } = event;
    const level = this.mapTypeToLevel(type);

    try {
      await this.underlyingNotifier.notify(level, message);
    } catch (error) {
      // Emit notification error event
      await this.eventBus.emit('notification:error', {
        notifier: this.underlyingNotifier.constructor.name,
        message,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: new Date(),
      });
    }
  }

  /**
   * Handle download:progress event
   */
  private async handleDownloadProgress(event: {
    filename: string;
    downloaded: number;
    total: number;
    percentage: number;
    speed: number;
    eta: number;
  }): Promise<void> {
    const { filename, percentage, speed, eta } = event;

    // Format progress message
    const speedMBps = (speed / 1_000_000).toFixed(2);
    const etaMin = Math.floor(eta / 60);
    const etaSec = Math.floor(eta % 60);
    const progressMsg = `Downloading ${filename}: ${percentage.toFixed(1)}% (${speedMBps} MB/s, ETA: ${etaMin}:${etaSec.toString().padStart(2, '0')})`;

    try {
      this.underlyingNotifier.progress(progressMsg);
    } catch (error) {
      // Emit notification error event (non-blocking)
      this.eventBus.emitSync('notification:error', {
        notifier: this.underlyingNotifier.constructor.name,
        message: progressMsg,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: new Date(),
      });
    }
  }

  /**
   * Map event type to notification level
   */
  private mapTypeToLevel(type: 'info' | 'success' | 'warning' | 'error'): NotificationLevel {
    const { NotificationLevel } = require('./notification-level.js');

    switch (type) {
      case 'info':
        return NotificationLevel.INFO;
      case 'success':
        return NotificationLevel.SUCCESS;
      case 'warning':
        return NotificationLevel.WARNING;
      case 'error':
        return NotificationLevel.ERROR;
      default:
        return NotificationLevel.INFO;
    }
  }

  // -------------------------------------------------------------------------
  // Notifier interface implementation (delegates to underlying notifier)
  // -------------------------------------------------------------------------

  async notify(level: NotificationLevel, message: string): Promise<void> {
    await this.underlyingNotifier.notify(level, message);
  }

  progress(message: string): void {
    this.underlyingNotifier.progress(message);
  }

  endProgress(): void {
    this.underlyingNotifier.endProgress();
  }

  /**
   * Get the underlying notifier
   */
  getUnderlyingNotifier(): Notifier {
    return this.underlyingNotifier;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an event-driven notifier wrapper
 *
 * @param eventBus - EventBus instance
 * @param underlyingNotifier - The actual notifier to forward events to
 * @returns EventNotifier instance (not started yet, call .start())
 */
export function createEventNotifier(eventBus: EventBus, underlyingNotifier: Notifier): EventNotifier {
  return new EventNotifier(eventBus, underlyingNotifier);
}
