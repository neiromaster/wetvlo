/**
 * TypedQueue - Passive queue for storing tasks of a single type
 *
 * A queue that manages tasks of a single type but does NOT execute them.
 * This is a passive data store that:
 * - Stores tasks in FIFO order
 * - Tracks cooldown time (next available timestamp)
 * - Tracks if a task of this type is currently executing
 * - Does NOT auto-start or have a processor function
 *
 * Key differences from AsyncQueue:
 * - No auto-start when items added
 * - No processor function (passive data store)
 * - Tracks cooldown from completion time
 * - No internal timing/sleep calls
 */

export type TaskItem<TaskType> = {
  data: TaskType;
  addedAt: Date;
};

/**
 * TypedQueue for a single task type
 */
export class TypedQueue<TaskType> {
  // State
  private queue: TaskItem<TaskType>[] = [];
  private isExecuting: boolean = false;
  private nextAvailableAt: Date = new Date(0); // Past = available
  private cooldownMs: number;

  /**
   * Create a new TypedQueue
   *
   * @param cooldownMs - Cooldown in milliseconds between task completions
   */
  constructor(cooldownMs: number = 0) {
    this.cooldownMs = cooldownMs;
  }

  /**
   * Add a task to the queue
   *
   * @param task - Task to add
   * @param delay - Optional delay in milliseconds before task is available
   */
  add(task: TaskType, delay?: number): void {
    const addedAt = new Date(Date.now() + (delay ?? 0));
    this.queue.push({ data: task, addedAt });
  }

  /**
   * Add a task to the front of the queue (priority)
   *
   * @param task - Task to add
   * @param delay - Optional delay in milliseconds before task is available
   */
  addFirst(task: TaskType, delay?: number): void {
    const addedAt = new Date(Date.now() + (delay ?? 0));
    this.queue.unshift({ data: task, addedAt });
  }

  /**
   * Get the next task from the queue
   *
   * @returns Next task or null if queue is empty
   */
  getNext(): TaskType | null {
    if (this.queue.length === 0) {
      return null;
    }

    const item = this.queue.shift();
    return item?.data ?? null;
  }

  /**
   * Peek at the next task without removing it
   *
   * @returns Next task or null if queue is empty
   */
  peekNext(): TaskType | null {
    if (this.queue.length === 0) {
      return null;
    }
    return this.queue[0]?.data ?? null;
  }

  /**
   * Check if a task can start at the given time
   *
   * @param now - Current time
   * @returns Whether task can start
   */
  canStart(now: Date): boolean {
    if (this.isExecuting) {
      return false;
    }

    if (now < this.nextAvailableAt) {
      return false;
    }

    // Check if head task is ready (respect delay)
    const head = this.queue[0];
    if (head && now < head.addedAt) {
      return false;
    }

    return true;
  }

  /**
   * Mark a task as started
   */
  markStarted(): void {
    this.isExecuting = true;
  }

  /**
   * Mark a task as completed and set cooldown
   *
   * @param cooldownMs - Cooldown in milliseconds from now
   */
  markCompleted(cooldownMs: number): void {
    this.isExecuting = false;
    this.cooldownMs = cooldownMs;
    this.nextAvailableAt = new Date(Date.now() + cooldownMs);
  }

  /**
   * Mark a task as failed and set cooldown
   *
   * @param cooldownMs - Cooldown in milliseconds from now
   */
  markFailed(cooldownMs: number): void {
    this.isExecuting = false;
    this.cooldownMs = cooldownMs;
    this.nextAvailableAt = new Date(Date.now() + cooldownMs);
  }

  /**
   * Check if queue has tasks
   *
   * @returns Whether queue has tasks
   */
  hasTasks(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Get the next time this queue can start a task
   *
   * @returns Next available time
   */
  getNextAvailableTime(): Date {
    // Start with cooldown time
    let time = this.nextAvailableAt;

    // Check head task delay
    const head = this.queue[0];
    if (head && head.addedAt > time) {
      time = head.addedAt;
    }

    return time;
  }

  /**
   * Get queue length
   *
   * @returns Number of tasks in queue
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if a task is currently executing
   *
   * @returns Whether a task is executing
   */
  getIsExecuting(): boolean {
    return this.isExecuting;
  }

  /**
   * Get cooldown duration
   *
   * @returns Cooldown in milliseconds
   */
  getCooldownMs(): number {
    return this.cooldownMs;
  }

  /**
   * Set cooldown duration
   *
   * @param cooldownMs - New cooldown in milliseconds
   */
  setCooldownMs(cooldownMs: number): void {
    this.cooldownMs = cooldownMs;
  }

  /**
   * Clear all tasks from the queue
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Get status information
   *
   * @returns Status object
   */
  getStatus(): {
    queueLength: number;
    isExecuting: boolean;
    nextAvailableAt: Date;
    cooldownMs: number;
    canStartNow: boolean;
  } {
    const now = new Date();
    return {
      queueLength: this.queue.length,
      isExecuting: this.isExecuting,
      nextAvailableAt: this.nextAvailableAt,
      cooldownMs: this.cooldownMs,
      canStartNow: this.canStart(now),
    };
  }
}
