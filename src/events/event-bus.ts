/**
 * EventBus - Central event bus using Emittery
 *
 * Provides type-safe event emission and subscription for the entire application.
 * All components communicate through events instead of direct method calls.
 *
 * NOTE: Emittery wraps all events in {name, data} format, so we unwrap them
 * before passing to user handlers for a cleaner API.
 */

import Emittery from 'emittery';
import type { EventName, WetvloEvent } from './event-types';

// ============================================================================
// Configuration
// ============================================================================

const DEBUG = process.env.DEBUG_EVENTS === 'true' || process.env.NODE_ENV === 'development';

// ============================================================================
// EventBus Class
// ============================================================================

export class EventBus {
  private emitter: Emittery<WetvloEvent>;

  constructor() {
    this.emitter = new Emittery<WetvloEvent>({
      debug: DEBUG
        ? {
            name: 'wetvlo-bus',
            enabled: true,
          }
        : undefined,
    });

    if (DEBUG) {
      // Log all events in debug mode (Emittery wraps events)
      this.emitter.onAny((eventData) => {
        const timestamp = new Date().toISOString();
        console.log(`[EVENT ${timestamp}] ${eventData.name}`, JSON.stringify(eventData.data, null, 2));
      });
    }
  }

  /**
   * Emit an event to all subscribers
   *
   * @param name - Event name
   * @param data - Event data
   */
  async emit<T extends EventName>(name: T, data: WetvloEvent[T]): Promise<void> {
    await this.emitter.emit(name, data);
  }

  /**
   * Emit an event synchronously (fire-and-forget)
   * Use this when you don't want to await event delivery
   *
   * @param name - Event name
   * @param data - Event data
   */
  emitSync<T extends EventName>(name: T, data: WetvloEvent[T]): void {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.emitter.emit(name, data);
  }

  /**
   * Subscribe to an event
   *
   * @param name - Event name to listen for
   * @param handler - Event handler function (receives unwrapped data)
   * @returns Unsubscribe function
   */
  on<T extends EventName>(name: T, handler: (data: WetvloEvent[T]) => void | Promise<void>): () => void {
    // Wrap handler to unwrap Emittery's {name, data} format
    const wrappedHandler = (eventData: { name: EventName; data: WetvloEvent[EventName] }) => {
      if (eventData.name === name) {
        return handler(eventData.data as WetvloEvent[T]);
      }
    };

    this.emitter.on(name, wrappedHandler as any);
    return () => {
      this.emitter.off(name, wrappedHandler as any);
    };
  }

  /**
   * Subscribe to an event with AbortSignal
   *
   * @param name - Event name to listen for
   * @param handler - Event handler function (receives unwrapped data)
   * @param signal - AbortSignal for automatic cleanup
   */
  onWithSignal<T extends EventName>(
    name: T,
    handler: (data: WetvloEvent[T]) => void | Promise<void>,
    signal: AbortSignal,
  ): void {
    // Wrap handler to unwrap Emittery's {name, data} format
    const wrappedHandler = (eventData: { name: EventName; data: WetvloEvent[EventName] }) => {
      if (eventData.name === name) {
        return handler(eventData.data as WetvloEvent[T]);
      }
    };

    this.emitter.on(name, wrappedHandler as any, { signal });
  }

  /**
   * Subscribe to multiple events
   *
   * @param handlers - Map of event names to handlers
   * @returns Unsubscribe function for all handlers
   */
  onMany(
    handlers: {
      [K in EventName]?: (data: WetvloEvent[K]) => void | Promise<void>;
    },
  ): () => void {
    const unsubscribers: Array<() => void> = [];

    for (const [name, handler] of Object.entries(handlers)) {
      if (handler) {
        unsubscribers.push(this.on(name as EventName, handler as any));
      }
    }

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  /**
   * Subscribe to all events
   *
   * @param handler - Event handler that receives all events (wrapped format)
   * @returns Unsubscribe function
   */
  onAny(handler: (data: { name: EventName; data: WetvloEvent[EventName] }) => void | Promise<void>): () => void {
    this.emitter.onAny(handler as any);
    return () => {
      this.emitter.offAny(handler as any);
    };
  }

  /**
   * One-time subscription to an event
   *
   * @param name - Event name to listen for
   * @param handler - Event handler function (receives unwrapped data)
   * @returns Unsubscribe function
   */
  once<T extends EventName>(name: T, handler: (data: WetvloEvent[T]) => void | Promise<void>): () => void {
    // Wrap handler to unwrap Emittery's {name, data} format
    // Return true to signal this is the matching event for once()
    const wrappedHandler = (eventData: { name: EventName; data: WetvloEvent[EventName] }) => {
      if (eventData.name === name) {
        const result = handler(eventData.data as WetvloEvent[T]);
        // Return true to indicate this event matched and should be removed
        // But wait for async handlers to complete
        if (result instanceof Promise) {
          result.then(() => true);
          return true;
        }
        return true;
      }
      return false; // Not our event
    };

    this.emitter.once(name, wrappedHandler as any);
    return () => {
      this.emitter.off(name, wrappedHandler as any);
    };
  }

  /**
   * Get async iterator for events
   *
   * @param name - Event name to iterate
   * @returns Async iterator (yields unwrapped data)
   */
  async *iterate<T extends EventName>(name: T): AsyncGenerator<WetvloEvent[T]> {
    for await (const eventData of this.emitter.events(name)) {
      // Emittery wraps events, need to unwrap
      yield (eventData as any).data as WetvloEvent[T];
    }
  }

  /**
   * Clear all listeners for an event or all events
   *
   * @param name - Optional event name to clear (clears all if not provided)
   */
  clearListeners<T extends EventName>(name?: T): void {
    if (name) {
      this.emitter.clearListeners(name);
    } else {
      this.emitter.clearListeners();
    }
  }

  /**
   * Get count of listeners for an event
   *
   * @param name - Event name
   * @returns Number of listeners
   */
  listenerCount<T extends EventName>(name: T): number {
    return this.emitter.listenerCount(name);
  }

  /**
   * Wait for an event to be emitted
   *
   * @param name - Event name to wait for
   * @param filter - Optional filter function (receives unwrapped data, return true to match)
   * @returns Promise that resolves with event data (unwrapped)
   */
  async waitFor<T extends EventName>(name: T, filter?: (data: WetvloEvent[T]) => boolean): Promise<WetvloEvent[T]> {
    if (filter) {
      // Manual implementation for filter support
      return new Promise((resolve) => {
        const wrappedHandler = (eventData: { name: EventName; data: WetvloEvent[EventName] }) => {
          if (eventData.name === name) {
            const unwrappedData = eventData.data as WetvloEvent[T];
            if (filter(unwrappedData)) {
              unsubscribe();
              resolve(unwrappedData);
            }
          }
          return false; // Continue waiting
        };

        const unsubscribe = () => {
          this.emitter.off(name, wrappedHandler as any);
        };

        this.emitter.on(name, wrappedHandler as any);
      });
    }
    // Emittery.once returns wrapped data, need to unwrap
    const result = await this.emitter.once(name);
    return (result as any).data as WetvloEvent[T];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalEventBus: EventBus | null = null;

/**
 * Get or create the global EventBus instance
 *
 * @returns EventBus singleton
 */
export function getEventBus(): EventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus();
  }
  return globalEventBus;
}

/**
 * Reset the global EventBus (mainly for testing)
 */
export function resetEventBus(): void {
  if (globalEventBus) {
    globalEventBus.clearListeners();
  }
  globalEventBus = null;
}
