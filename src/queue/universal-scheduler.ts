/**
 * UniversalScheduler - Central scheduler for all typed queues
 *
 * Coordinates all typed queues with a single executor:
 * - Only one task executing globally
 * - Single active timer (cleared on scheduling attempt)
 * - Fair round-robin queue selection
 * - Event-driven (triggers on task add, completion, timer)
 *
 * Now emits events instead of using callbacks for better decoupling.
 *
 * Key features:
 * - Centralized scheduling logic
 * - Proper cooldowns (end-to-start timing)
 * - Reusable for any task type
 * - Timer-based instead of polling
 * - Event-based communication with QueueManager
 */

import type { EventBus } from '../events/event-bus.js';
import type { WetvloEvent } from '../events/event-types.js';
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

  // Callback (deprecated - use events instead)
  private executor: ExecutorCallback<TaskType>;
  private onWait?: (queueName: string, waitMs: number, nextTime: Date) => void; // TODO: Remove in next version

  // EventBus for emitting events
  private eventBus?: EventBus;

  /**
   * Create a new UniversalScheduler
   *
   * @param executor - Function to execute a task
   * @param eventBus - Optional EventBus for emitting events
   */
  constructor(executor: ExecutorCallback<TaskType>, eventBus?: EventBus) {
    this.executor = executor;
    this.eventBus = eventBus;
  }

  /**
   * Set callback for when the scheduler is waiting
   *
   * @param callback - Callback function
   * @deprecated Use EventBus events instead
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

    // Emit event when queue is registered
    this.emitEvent('queue:register', {
      queueName: typeName,
      cooldownMs,
    });
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

    // Emit event when queues are cleared
    this.emitEvent('queue:cleared', {});
  }

  /**
   * Reset all queues to initial state
   *
   * Clears tasks, execution state, and cooldown for all queues.
   */
  resetQueues(): void {
    for (const queue of this.queues.values()) {
      queue.reset();
    }
    this.clearTimer();
    this.roundRobinIndex = 0;

    // Emit event when queues are reset
    this.emitEvent('queue:reset', {});
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

    const taskId = this.generateTaskId(task);
    queue.add(task, delay);

    // Emit event when task is added
    this.emitEvent('queue:add', {
      queueName: typeName,
      taskId,
      type: this.getTaskType(typeName),
      data: task,
      priority: false,
    });

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

    const taskId = this.generateTaskId(task);
    queue.addFirst(task, delay);

    // Emit event when priority task is added
    this.emitEvent('queue:add', {
      queueName: typeName,
      taskId,
      type: this.getTaskType(typeName),
      data: task,
      priority: true,
    });

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

    // Emit event when task completes
    this.emitEvent('queue:task:complete', {
      queueName: typeName,
      taskId: 'completed',
      type: this.getTaskType(typeName),
      result: { success: true },
      timestamp: new Date(),
      duration: actualCooldown,
    });

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

    // Emit event when task fails
    this.emitEvent('queue:task:error', {
      queueName: typeName,
      taskId: 'failed',
      type: this.getTaskType(typeName),
      error: new Error('Task execution failed'),
      retryCount: 0,
      willRetry: true,
      timestamp: new Date(),
    });

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
    } else {
      // No tasks pending - emit idle event
      this.emitEvent('queue:idle', {
        timestamp: new Date(),
        activeQueues: Array.from(this.queues.keys()),
      });
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

          // Emit event when task starts
          this.emitEvent('queue:task:start', {
            queueName,
            taskId: this.generateTaskId(task),
            type: this.getTaskType(queueName),
            data: task,
            timestamp: new Date(),
          });

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

    // Emit wait event (preferred) or call callback (deprecated)
    if (this.eventBus && waitMs > 1000) {
      this.emitEvent('queue:wait', {
        queueName,
        waitMs,
        nextTime,
        timestamp: new Date(),
      });
    } else if (this.onWait && waitMs > 1000) {
      // Deprecated callback path - will be removed
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

  /**
   * Generate a unique task ID
   *
   * @param task - Task object
   * @returns Unique task ID
   */
  private generateTaskId(task: TaskType): string {
    // Simple hash-based ID (could be enhanced)
    const str = JSON.stringify(task);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `task_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Extract task type from queue name
   *
   * @param queueName - Queue name (e.g., "check:domain:hash" or "download:domain")
   * @returns Task type ("check" or "download")
   */
  private getTaskType(queueName: string): 'check' | 'download' {
    if (queueName.startsWith('check:')) {
      return 'check';
    }
    return 'download';
  }

  /**
   * Emit an event to the EventBus (if available)
   *
   * @param name - Event name
   * @param data - Event data
   */
  private emitEvent<K extends keyof WetvloEvent>(name: K, data: WetvloEvent[K]): void {
    if (this.eventBus) {
      // Fire-and-forget - don't await
      this.eventBus.emitSync(name, data);
    }
  }
}
