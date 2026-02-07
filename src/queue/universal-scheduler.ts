/**
 * UniversalScheduler - Central scheduler for all typed queues
 *
 * Coordinates all typed queues with a single executor:
 * - Only one task executing globally
 * - Single active timer (cleared on scheduling attempt)
 * - Fair round-robin queue selection
 * - Event-driven (triggers on task add, completion, timer)
 *
 * Key features:
 * - Centralized scheduling logic
 * - Proper cooldowns (end-to-start timing)
 * - Reusable for any task type
 * - Timer-based instead of polling
 */

import { TypedQueue } from './typed-queue.js';

/**
 * Executor callback function type
 */
export type ExecutorCallback<TaskType> = (task: TaskType, queueName: string) => Promise<void>;

/**
 * Universal scheduler for coordinating all typed queues
 */
export class UniversalScheduler<TaskType> {
  // State
  private queues: Map<string, TypedQueue<TaskType>> = new Map();
  private queueCooldowns: Map<string, number> = new Map(); // Store default cooldown per queue
  private executorBusy: boolean = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private roundRobinIndex: number = 0;
  private stopped: boolean = false;

  // Callback
  private executor: ExecutorCallback<TaskType>;
  private onWait?: (queueName: string, waitMs: number, nextTime: Date) => void;

  /**
   * Create a new UniversalScheduler
   *
   * @param executor - Function to execute a task
   */
  constructor(executor: ExecutorCallback<TaskType>) {
    this.executor = executor;
  }

  /**
   * Set callback for when the scheduler is waiting
   *
   * @param callback - Callback function
   */
  setOnWait(callback: (queueName: string, waitMs: number, nextTime: Date) => void): void {
    this.onWait = callback;
  }

  /**
   * Register a new queue type
   *
   * @param typeName - Unique name for this queue type
   * @param cooldownMs - Default cooldown in milliseconds
   */
  registerQueue(typeName: string, cooldownMs: number): void {
    if (this.queues.has(typeName)) {
      throw new Error(`Queue ${typeName} is already registered`);
    }

    const queue = new TypedQueue<TaskType>(cooldownMs);
    this.queues.set(typeName, queue);
    this.queueCooldowns.set(typeName, cooldownMs);
  }

  /**
   * Check if a queue is registered
   *
   * @param typeName - Queue type name
   * @returns Whether queue is registered
   */
  hasQueue(typeName: string): boolean {
    return this.queues.has(typeName);
  }

  /**
   * Unregister a queue type
   *
   * @param typeName - Queue type name to unregister
   */
  unregisterQueue(typeName: string): void {
    this.queues.delete(typeName);
    this.queueCooldowns.delete(typeName);
  }

  clearQueues(): void {
    for (const queue of this.queues.values()) {
      queue.clear();
    }
    this.clearTimer();
    this.roundRobinIndex = 0;
  }

  /**
   * Add a task to a specific queue
   *
   * Triggers scheduling attempt.
   *
   * @param typeName - Queue type name
   * @param task - Task to add
   * @param delay - Optional delay in milliseconds before task is available
   */
  addTask(typeName: string, task: TaskType, delay?: number): void {
    const queue = this.queues.get(typeName);
    if (!queue) {
      throw new Error(`Queue ${typeName} is not registered`);
    }

    queue.add(task, delay);

    // Trigger scheduling attempt (might be executable immediately)
    if (!this.stopped) {
      this.scheduleNext();
    }
  }

  /**
   * Add a priority task to the front of a specific queue
   *
   * @param typeName - Queue type name
   * @param task - Task to add
   * @param delay - Optional delay in milliseconds
   */
  addPriorityTask(typeName: string, task: TaskType, delay?: number): void {
    const queue = this.queues.get(typeName);
    if (!queue) {
      throw new Error(`Queue ${typeName} is not registered`);
    }

    queue.addFirst(task, delay);

    // Trigger scheduling attempt
    if (!this.stopped) {
      this.scheduleNext();
    }
  }

  /**
   * Mark a task as complete
   *
   * Called by executor when task completes successfully.
   * Triggers next scheduling attempt.
   *
   * @param typeName - Queue type name
   * @param cooldownMs - Optional cooldown override (uses queue default if not provided)
   */
  markTaskComplete(typeName: string, cooldownMs?: number): void {
    const queue = this.queues.get(typeName);
    if (!queue) {
      throw new Error(`Queue ${typeName} is not registered`);
    }

    const actualCooldown = cooldownMs ?? this.queueCooldowns.get(typeName) ?? 0;
    queue.markCompleted(actualCooldown);
    this.executorBusy = false;

    // Trigger next scheduling attempt
    if (!this.stopped) {
      this.scheduleNext();
    }
  }

  /**
   * Mark a task as failed
   *
   * Called by executor when task fails.
   * Triggers next scheduling attempt.
   *
   * @param typeName - Queue type name
   * @param cooldownMs - Optional cooldown override (uses queue default if not provided)
   */
  markTaskFailed(typeName: string, cooldownMs?: number): void {
    const queue = this.queues.get(typeName);
    if (!queue) {
      throw new Error(`Queue ${typeName} is not registered`);
    }

    const actualCooldown = cooldownMs ?? this.queueCooldowns.get(typeName) ?? 0;
    queue.markFailed(actualCooldown);
    this.executorBusy = false;

    // Trigger next scheduling attempt
    if (!this.stopped) {
      this.scheduleNext();
    }
  }

  /**
   * Schedule the next task
   *
   * Attempts to schedule immediately if possible,
   * otherwise sets a timer for the earliest available time.
   */
  scheduleNext(): void {
    if (this.stopped) {
      return;
    }

    // Clear any existing timer
    this.clearTimer();

    // Try to schedule immediately
    const scheduled = this.trySchedule();

    if (scheduled) {
      // Task scheduled and executor is busy.
      // No need to set timer, completion will trigger next schedule.
      return;
    }

    // If executor is busy but nothing new was scheduled (because it was already busy),
    // we also don't need a timer.
    if (this.executorBusy) {
      return;
    }

    // No task running and none could be scheduled.
    // Check if we should set a timer for the next available time
    const next = this.getEarliestAvailableTime();
    if (next) {
      const now = Date.now();
      const waitMs = Math.max(0, next.time.getTime() - now);
      this.scheduleTimer(waitMs, next.queueName, next.time);
    }
  }

  /**
   * Try to schedule a task now
   *
   * @returns Whether a task was scheduled
   */
  private trySchedule(): boolean {
    // Can't schedule if executor is busy
    if (this.executorBusy) {
      return false;
    }

    const now = new Date();

    // Collect queue names for round-robin
    const queueNames = Array.from(this.queues.keys());
    if (queueNames.length === 0) {
      return false;
    }

    // Try each queue in round-robin order
    for (let i = 0; i < queueNames.length; i++) {
      const index = (this.roundRobinIndex + i) % queueNames.length;
      const queueName = queueNames[index];
      if (!queueName) continue;

      const queue = this.queues.get(queueName);
      if (!queue) continue;

      // Check if queue has tasks and can start
      if (queue.hasTasks() && queue.canStart(now)) {
        // Get next task
        const task = queue.getNext();
        if (task) {
          // Mark as started
          queue.markStarted();
          this.executorBusy = true;
          this.roundRobinIndex = (index + 1) % queueNames.length;

          // Execute task (fire and forget - executor will call back)
          this.executeTask(queueName, task).catch((error) => {
            // Execution failed - mark as failed and continue
            console.error(`[UniversalScheduler] Task execution failed: ${error}`);
            this.markTaskFailed(queueName);
          });

          return true;
        }
      }
    }

    return false;
  }

  /**
   * Execute a task
   *
   * @param queueName - Queue name
   * @param task - Task to execute
   */
  private async executeTask(queueName: string, task: TaskType): Promise<void> {
    await this.executor(task, queueName);
  }

  /**
   * Schedule a timer for the next attempt
   *
   * @param waitMs - Milliseconds to wait
   * @param queueName - Name of the queue we are waiting for
   * @param nextTime - Time when the task will be ready
   */
  private scheduleTimer(waitMs: number, queueName: string, nextTime: Date): void {
    this.clearTimer();

    // Notify waiting state if callback defined and wait is significant (>1s)
    if (this.onWait && waitMs > 1000) {
      this.onWait(queueName, waitMs, nextTime);
    }

    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.scheduleNext();
    }, waitMs);
  }

  /**
   * Clear the active timer
   */
  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Get the earliest available time across all queues
   *
   * @returns Earliest available time and queue name, or null if no queues with tasks
   */
  private getEarliestAvailableTime(): { time: Date; queueName: string } | null {
    let result: { time: Date; queueName: string } | null = null;

    for (const [name, queue] of this.queues.entries()) {
      // Only consider queues that have tasks
      if (!queue.hasTasks()) {
        continue;
      }

      const nextTime = queue.getNextAvailableTime();
      if (result === null || nextTime < result.time) {
        result = { time: nextTime, queueName: name };
      }
    }

    return result;
  }

  /**
   * Stop the scheduler
   *
   * Clears timers and prevents further scheduling.
   */
  stop(): void {
    this.stopped = true;
    this.clearTimer();
  }

  /**
   * Resume the scheduler
   */
  resume(): void {
    this.stopped = false;
    this.scheduleNext();
  }

  /**
   * Get statistics for all queues
   *
   * @returns Map of queue name to status
   */
  getStats(): Map<string, { queueLength: number; isExecuting: boolean; nextAvailableAt: Date }> {
    const stats = new Map();

    for (const [name, queue] of this.queues.entries()) {
      const status = queue.getStatus();
      stats.set(name, {
        queueLength: status.queueLength,
        isExecuting: status.isExecuting,
        nextAvailableAt: status.nextAvailableAt,
      });
    }

    return stats;
  }

  /**
   * Check if executor is busy
   *
   * @returns Whether executor is busy
   */
  isExecutorBusy(): boolean {
    return this.executorBusy;
  }

  /**
   * Check if there are any pending tasks
   *
   * @returns Whether there are pending tasks
   */
  hasPendingTasks(): boolean {
    for (const queue of this.queues.values()) {
      if (queue.hasTasks()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get total pending tasks across all queues
   *
   * @returns Total pending task count
   */
  getTotalPendingTasks(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.getQueueLength();
    }
    return total;
  }
}
