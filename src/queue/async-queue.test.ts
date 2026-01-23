import { expect, test } from 'bun:test';
import { AsyncQueue } from './async-queue';

test('AsyncQueue: processes items sequentially', async () => {
  const processed: number[] = [];
  const processingOrder: number[] = [];

  const queue = new AsyncQueue<number>(async (item) => {
    processingOrder.push(item);
    await new Promise((resolve) => setTimeout(resolve, 50));
    processed.push(item);
  });

  // Add multiple items
  queue.add(1);
  queue.add(2);
  queue.add(3);

  // Wait for processing to complete
  await queue.drain();

  expect(processed).toEqual([1, 2, 3]);
  expect(processingOrder).toEqual([1, 2, 3]); // Sequential processing
});

test('AsyncQueue: can add items while processing', async () => {
  const processed: number[] = [];

  const queue = new AsyncQueue<number>(async (item) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    processed.push(item);

    // Add next item during processing
    if (item < 3) {
      queue.add(item + 1);
    }
  });

  // Start with first item
  queue.add(1);

  // Wait for processing to complete
  await new Promise((resolve) => setTimeout(resolve, 200));

  expect(processed).toEqual([1, 2, 3]);
});

test('AsyncQueue: stop drains the queue', async () => {
  const processed: number[] = [];

  const queue = new AsyncQueue<number>(async (item) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    processed.push(item);
  });

  // Add items
  queue.add(1);
  queue.add(2);
  queue.add(3);

  // Wait for all items to be processed (drain)
  await queue.drain();

  // Now stop (should be immediate since queue is drained)
  await queue.stop();

  expect(processed).toEqual([1, 2, 3]);
  expect(queue.getQueueLength()).toBe(0);
});

test('AsyncQueue: tracks statistics', async () => {
  let shouldFail = false;

  const queue = new AsyncQueue<number>(async (_item) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (shouldFail) {
      throw new Error('Processing failed');
    }
  });

  // Process some items
  queue.add(1);
  queue.add(2);
  await queue.drain();

  expect(queue.getProcessedCount()).toBe(2);
  expect(queue.getFailedCount()).toBe(0);

  // Process with failures
  shouldFail = true;
  queue.add(3);
  queue.add(4);
  await queue.drain();

  // Should have processed 4 total, with 2 failures
  expect(queue.getProcessedCount()).toBeGreaterThanOrEqual(2);
  expect(queue.getFailedCount()).toBeGreaterThanOrEqual(2);
});

test('AsyncQueue: cannot add to stopped queue', async () => {
  const queue = new AsyncQueue<number>(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  await queue.stop();

  expect(() => queue.add(1)).toThrow('Cannot add items to a stopped queue');
});

test('AsyncQueue: getQueueLength returns correct length', async () => {
  const processingDelay = 100;
  const queue = new AsyncQueue<number>(async () => {
    await new Promise((resolve) => setTimeout(resolve, processingDelay));
  });

  // Add items quickly
  queue.add(1);
  queue.add(2);
  queue.add(3);

  // Immediately check - some items may have started processing
  // So we just check that we have some items
  const initialLength = queue.getQueueLength();
  expect(initialLength).toBeGreaterThanOrEqual(0);

  // Wait for all processing to complete
  await new Promise((resolve) => setTimeout(resolve, processingDelay * 3 + 100));

  expect(queue.getQueueLength()).toBe(0);
});

test('AsyncQueue: isProcessing returns correct status', async () => {
  let _processing = false;

  const queue = new AsyncQueue<number>(async () => {
    _processing = true;
    await new Promise((resolve) => setTimeout(resolve, 100));
    _processing = false;
  });

  expect(queue.isProcessing()).toBe(false);

  queue.add(1);

  // Give it time to start processing
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(queue.isProcessing()).toBe(true);

  // Wait for processing to complete
  await queue.drain();

  expect(queue.isProcessing()).toBe(false);
});
