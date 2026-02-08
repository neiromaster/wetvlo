import { beforeEach, describe, expect, it } from 'bun:test';
import { TypedQueue } from './typed-queue.js';

describe('TypedQueue', () => {
  let queue: TypedQueue<string>;

  beforeEach(() => {
    queue = new TypedQueue<string>(1000); // 1s cooldown
  });

  it('should initialize empty', () => {
    expect(queue.hasTasks()).toBe(false);
    expect(queue.getQueueLength()).toBe(0);
    expect(queue.getNext()).toBeNull();
  });

  it('should add items and retrieve them in order', () => {
    queue.add('task1');
    queue.add('task2');

    expect(queue.getQueueLength()).toBe(2);
    expect(queue.getNext()).toBe('task1');
    expect(queue.getQueueLength()).toBe(1);
    expect(queue.getNext()).toBe('task2');
    expect(queue.getQueueLength()).toBe(0);
  });

  it('should handle peeking', () => {
    queue.add('task1');
    expect(queue.peekNext()).toBe('task1');
    expect(queue.getQueueLength()).toBe(1); // Should not remove
  });

  it('should respect cooldowns', () => {
    const now = new Date();

    // Initially can start (default cooldown 0 or past)
    expect(queue.canStart(now)).toBe(true);

    // Mark completed sets cooldown
    queue.markCompleted(1000);

    const immediate = new Date(now.getTime() + 10);
    expect(queue.canStart(immediate)).toBe(false);

    const afterCooldown = new Date(now.getTime() + 1001);
    expect(queue.canStart(afterCooldown)).toBe(true);
  });

  it('should handle execution state', () => {
    expect(queue.getIsExecuting()).toBe(false);

    queue.markStarted();
    expect(queue.getIsExecuting()).toBe(true);

    // Cannot start while executing even if time allows
    expect(queue.canStart(new Date())).toBe(false);

    queue.markCompleted(0);
    expect(queue.getIsExecuting()).toBe(false);
  });

  it('should clear queue', () => {
    queue.add('task1');
    queue.clear();
    expect(queue.hasTasks()).toBe(false);
  });

  it('reset should clear queue, execution state, and cooldown', () => {
    // Add task and mark as started
    queue.add('test task');
    queue.markStarted();

    // Simulate cooldown
    queue.markCompleted(5000);

    expect(queue.getStatus().queueLength).toBe(1);
    expect(queue.getStatus().isExecuting).toBe(false); // markCompleted sets isExecuting to false
    expect(queue.getStatus().canStartNow).toBe(false); // In cooldown

    // Reset
    queue.reset();

    expect(queue.getStatus().queueLength).toBe(0);
    expect(queue.getStatus().isExecuting).toBe(false);
    expect(queue.getStatus().canStartNow).toBe(true); // Can start immediately
  });

  it('should provide status', () => {
    queue.add('task1');
    const status = queue.getStatus();

    expect(status.queueLength).toBe(1);
    expect(status.isExecuting).toBe(false);
    expect(status.cooldownMs).toBe(1000);
  });
});
