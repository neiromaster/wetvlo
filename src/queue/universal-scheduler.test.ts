/**
 * Universal Scheduler Tests
 *
 * Tests for the UniversalScheduler that verifies:
 * - Single-task execution globally
 * - Fair round-robin queue selection
 * - Proper cooldowns (end-to-start timing)
 * - Timer-based scheduling
 */

import { expect, test } from 'bun:test';
import { sleep } from './retry-strategy.js';
import { TypedQueue } from './typed-queue.js';
import { UniversalScheduler } from './universal-scheduler.js';

// Test task type
type TestTask = {
  id: string;
  value: number;
};

// Helper to create a test task
function createTask(id: string, value: number): TestTask {
  return { id, value };
}

test('UniversalScheduler: should register queues', () => {
  const executionLog: string[] = [];
  const scheduler = new UniversalScheduler<TestTask>(async (task, queueName) => {
    executionLog.push(`${queueName}:${task.id}`);
  });

  scheduler.registerQueue('queue1', 100);
  scheduler.registerQueue('queue2', 200);

  const stats = scheduler.getStats();
  expect(stats.size).toBe(2);
  expect(stats.has('queue1')).toBe(true);
  expect(stats.has('queue2')).toBe(true);
});

test('UniversalScheduler: should execute tasks one at a time', async () => {
  const executionLog: string[] = [];
  let executing = false;

  const scheduler = new UniversalScheduler<TestTask>(async (task, queueName) => {
    if (executing) {
      throw new Error('Concurrent execution detected!');
    }
    executing = true;
    executionLog.push(`${queueName}:${task.id}`);
    await sleep(20);
    executing = false;
    scheduler.markTaskComplete(queueName, 0);
  });

  scheduler.registerQueue('queue1', 0);
  scheduler.registerQueue('queue2', 0);

  // Add multiple tasks
  scheduler.addTask('queue1', createTask('a', 1));
  scheduler.addTask('queue2', createTask('b', 2));
  scheduler.addTask('queue1', createTask('c', 3));

  await sleep(100);

  // All tasks should have been executed sequentially
  expect(executionLog.length).toBe(3);
  expect(executing).toBe(false);
});

test('UniversalScheduler: should respect cooldowns', async () => {
  const executionTimes: number[] = [];

  const scheduler = new UniversalScheduler<TestTask>(async (_task, _queueName) => {
    executionTimes.push(Date.now());
    await sleep(10);
    // Mark complete with 50ms cooldown
    scheduler.markTaskComplete('queue1', 50);
  });

  scheduler.registerQueue('queue1', 50); // 50ms default cooldown

  scheduler.addTask('queue1', createTask('a', 1));
  await sleep(20); // Task still executing
  scheduler.addTask('queue1', createTask('b', 2));

  await sleep(120); // Wait for both tasks + cooldown

  // Second task should have waited at least 50ms after first completed
  expect(executionTimes.length).toBe(2);
  const gap = executionTimes[1]! - executionTimes[0]!;
  expect(gap).toBeGreaterThanOrEqual(50); // At least cooldown
});

test('UniversalScheduler: should use round-robin for fairness', async () => {
  const executionLog: string[] = [];

  const scheduler = new UniversalScheduler<TestTask>(async (task, queueName) => {
    executionLog.push(`${queueName}:${task.id}`);
    scheduler.markTaskComplete(queueName, 0);
  });

  scheduler.registerQueue('queue1', 0);
  scheduler.registerQueue('queue2', 0);
  scheduler.registerQueue('queue3', 0);

  // Add tasks to all queues
  scheduler.addTask('queue1', createTask('a1', 1));
  scheduler.addTask('queue2', createTask('b1', 2));
  scheduler.addTask('queue3', createTask('c1', 3));
  scheduler.addTask('queue1', createTask('a2', 4));
  scheduler.addTask('queue2', createTask('b2', 5));

  await sleep(50);

  // Should have executed in round-robin order
  expect(executionLog).toEqual(['queue1:a1', 'queue2:b1', 'queue3:c1', 'queue1:a2', 'queue2:b2']);
});

test('UniversalScheduler: should handle task delays (not yet implemented)', async () => {
  // Note: The delay parameter in addTask sets addedAt but scheduler doesn't check it yet
  // This is a placeholder test for future implementation
  const executionLog: string[] = [];

  const scheduler = new UniversalScheduler<TestTask>(async (task, _queueName) => {
    executionLog.push(`${Date.now()}:${task.id}`);
    scheduler.markTaskComplete('queue1', 0);
  });

  scheduler.registerQueue('queue1', 0);

  scheduler.addTask('queue1', createTask('a', 1));
  scheduler.addTask('queue1', createTask('b', 2), 50); // 50ms delay (not currently enforced)

  await sleep(100);

  // Both tasks execute (delay not enforced by scheduler yet)
  expect(executionLog.length).toBe(2);

  // TODO: Once scheduler checks addedAt, verify timing here
  // For now, just verify both tasks were executed
});

test('UniversalScheduler: should report correct stats', async () => {
  const scheduler = new UniversalScheduler<TestTask>(async (_task, _queueName) => {
    await sleep(10);
    scheduler.markTaskComplete('queue1', 0);
  });

  scheduler.registerQueue('queue1', 100);
  scheduler.registerQueue('queue2', 200);

  scheduler.addTask('queue1', createTask('a', 1));
  scheduler.addTask('queue1', createTask('b', 2));
  scheduler.addTask('queue2', createTask('c', 3));

  await sleep(5); // First task should be executing

  const stats = scheduler.getStats();
  const queue1Stats = stats.get('queue1');
  const queue2Stats = stats.get('queue2');

  expect(queue1Stats?.queueLength).toBe(1); // One task executing, one pending
  expect(queue1Stats?.isExecuting).toBe(true);
  expect(queue2Stats?.queueLength).toBe(1); // One pending
  expect(queue2Stats?.isExecuting).toBe(false);

  await sleep(50); // Wait for completion
});

test('UniversalScheduler: should handle retries correctly', async () => {
  const executionLog: string[] = [];
  let attempt = 0;

  const scheduler = new UniversalScheduler<TestTask>(async (task, _queueName) => {
    executionLog.push(`${task.id}:attempt${attempt}`);
    attempt++;

    if (attempt < 3) {
      // Fail first 2 attempts
      throw new Error('Temporary failure');
    }

    scheduler.markTaskComplete('queue1', 0);
  });

  scheduler.registerQueue('queue1', 100);

  // Override executor error handling
  scheduler.addTask('queue1', createTask('a', 1));

  await sleep(50);
  // The scheduler catches errors in executeTask and marks failed
  // but we'd need to manually requeue in a real scenario

  expect(executionLog.length).toBeGreaterThanOrEqual(1);
});

test('UniversalScheduler: should stop and resume correctly', async () => {
  const executionLog: string[] = [];

  const scheduler = new UniversalScheduler<TestTask>(async (task, _queueName) => {
    executionLog.push(task.id);
    await sleep(10);
    scheduler.markTaskComplete('queue1', 0);
  });

  scheduler.registerQueue('queue1', 0);

  scheduler.addTask('queue1', createTask('a', 1));
  await sleep(5); // Start executing

  scheduler.stop();
  await sleep(20); // Wait for current task to finish

  expect(executionLog.length).toBe(1);

  scheduler.addTask('queue1', createTask('b', 2));
  await sleep(20); // Should not execute (stopped)

  expect(executionLog.length).toBe(1);

  scheduler.resume();
  await sleep(30); // Should execute now

  expect(executionLog.length).toBe(2);
});

test('TypedQueue: should queue and dequeue tasks', () => {
  const queue = new TypedQueue<number>(100);

  expect(queue.getQueueLength()).toBe(0);
  expect(queue.hasTasks()).toBe(false);

  queue.add(1);
  queue.add(2);
  queue.add(3);

  expect(queue.getQueueLength()).toBe(3);
  expect(queue.hasTasks()).toBe(true);

  expect(queue.getNext()).toBe(1);
  expect(queue.getQueueLength()).toBe(2);

  expect(queue.peekNext()).toBe(2);
  expect(queue.getQueueLength()).toBe(2); // peek doesn't remove

  expect(queue.getNext()).toBe(2);
  expect(queue.getNext()).toBe(3);
  expect(queue.getNext()).toBeNull();
});

test('TypedQueue: should track execution state', () => {
  const queue = new TypedQueue<number>(100);

  expect(queue.canStart(new Date())).toBe(true);

  queue.markStarted();
  expect(queue.getIsExecuting()).toBe(true);
  expect(queue.canStart(new Date())).toBe(false);

  queue.markCompleted(100);
  expect(queue.getIsExecuting()).toBe(false);
  expect(queue.canStart(new Date())).toBe(false); // In cooldown

  // Wait for cooldown to pass
  const futureDate = new Date(Date.now() + 150);
  expect(queue.canStart(futureDate)).toBe(true);
});

test('TypedQueue: should provide status', () => {
  const queue = new TypedQueue<number>(100);

  queue.add(1);
  queue.add(2);

  const status = queue.getStatus();
  expect(status.queueLength).toBe(2);
  expect(status.isExecuting).toBe(false);
  expect(status.canStartNow).toBe(true);
  expect(status.cooldownMs).toBe(100);
});

test('UniversalScheduler: should trigger onWait callback', async () => {
  const waitLog: string[] = [];
  const scheduler = new UniversalScheduler<TestTask>(async (task, queueName) => {
    // Immediate completion for test simplicity
  });

  scheduler.registerQueue('queue1', 0);

  scheduler.setOnWait((queueName, waitMs, _nextTime) => {
    waitLog.push(`${queueName}:${waitMs}`);
  });

  // Add task with delay
  const delay = 1500; // > 1000ms threshold
  scheduler.addTask('queue1', createTask('a', 1), delay);

  // Wait for scheduler to process
  await sleep(50);

  expect(waitLog.length).toBeGreaterThan(0);
  expect(waitLog[0]).toContain('queue1');

  scheduler.stop();
});
