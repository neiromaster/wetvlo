/**
 * AsyncQueue - Base queue with concatMap semantics
 *
 * Implements a queue that processes items sequentially (concatMap pattern).
 * Items can be added while processing is in progress.
 * Supports graceful shutdown by draining the queue.
 */

import type { QueueProcessor, QueueStatus } from './types.js';

export class AsyncQueue<T> {
  private queue: T[] = [];
  private processing = false;
  private stopped = false;
  private processor: QueueProcessor<T>;
  private processedCount = 0;
  private failedCount = 0;
  private resolveStop: (() => void) | null = null;
  private currentProcessPromise: Promise<void> | null = null;

  /**
   * Create a new AsyncQueue
   *
   * @param processor - Function to process each item
   */
  constructor(processor: QueueProcessor<T>) {
    this.processor = processor;
  }

  /**
   * Add an item to the queue
   *
   * If the queue is not currently processing, it will start processing.
   *
   * @param item - Item to add
   */
  add(item: T): void {
    if (this.stopped) {
      throw new Error('Cannot add items to a stopped queue');
    }

    this.queue.push(item);

    // Start processing if not already running
    if (!this.processing) {
      this.currentProcessPromise = this.processQueue();
    }
  }

  /**
   * Add multiple items to the queue
   *
   * @param items - Items to add
   */
  addAll(items: T[]): void {
    for (const item of items) {
      this.add(item);
    }
  }

  /**
   * Start processing the queue
   *
   * This is called automatically when items are added, but can be called
   * explicitly to ensure processing has started.
   */
  start(): void {
    if (this.stopped) {
      throw new Error('Cannot start a stopped queue');
    }

    if (!this.processing && this.queue.length > 0) {
      this.currentProcessPromise = this.processQueue();
    }
  }

  /**
   * Stop the queue and wait for all items to be processed
   *
   * The queue will finish processing the current item and all items
   * currently in the queue before stopping. No new items can be added.
   *
   * @returns Promise that resolves when queue is drained
   */
  async stop(): Promise<void> {
    this.stopped = true;

    // Wait for current processing to complete
    if (this.currentProcessPromise) {
      await this.currentProcessPromise;
    }

    // Resolve any pending stop promises
    if (this.resolveStop) {
      this.resolveStop();
      this.resolveStop = null;
    }
  }

  /**
   * Get the current number of items in the queue
   *
   * @returns Queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue is currently processing an item
   *
   * @returns Whether processing is in progress
   */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Check if the queue has been stopped
   *
   * @returns Whether queue is stopped
   */
  isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Get comprehensive queue status
   *
   * @returns Queue status information
   */
  getStatus(): QueueStatus {
    return {
      queueLength: this.queue.length,
      isProcessing: this.processing,
      processedCount: this.processedCount,
      failedCount: this.failedCount,
    };
  }

  /**
   * Get total number of processed items (successful and failed)
   *
   * @returns Total processed count
   */
  getProcessedCount(): number {
    return this.processedCount;
  }

  /**
   * Get number of failed items
   *
   * @returns Failed count
   */
  getFailedCount(): number {
    return this.failedCount;
  }

  /**
   * Reset statistics (mainly for testing)
   */
  resetStats(): void {
    this.processedCount = 0;
    this.failedCount = 0;
  }

  /**
   * Internal method to process the queue
   *
   * Processes items one at a time (concatMap semantics).
   * Continues until queue is empty or stopped.
   */
  private async processQueue(): Promise<void> {
    if (this.processing) {
      // Already processing, return existing promise
      return this.currentProcessPromise as Promise<void>;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0 && !this.stopped) {
        const item = this.queue.shift();

        if (!item) {
          continue;
        }

        try {
          // biome-ignore lint/performance/noAwaitInLoops: Sequential processing is intentional for queue semantics
          await this.processor(item);
          this.processedCount++;
        } catch (error) {
          this.failedCount++;
          // Log but continue processing next item
          console.error('Queue processor error:', error);
        }
      }

      // Resolve stop promise if queue is drained
      if (this.queue.length === 0 && this.resolveStop) {
        this.resolveStop();
        this.resolveStop = null;
      }
    } finally {
      this.processing = false;
      this.currentProcessPromise = null;
    }
  }

  /**
   * Create a promise that resolves when the queue is drained
   *
   * @returns Promise that resolves when queue is empty
   */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && !this.processing) {
      return;
    }

    return new Promise((resolve) => {
      this.resolveStop = resolve;
    });
  }
}
