import { expect, test } from 'bun:test';
import { calculateBackoff, getRetryDelay, shouldRetry, sleep } from './retry-strategy';
import type { RetryConfig } from './types';

test('calculateBackoff: basic exponential backoff', () => {
  const result = calculateBackoff(0, 5000, 2, 0);
  expect(result).toBe(5000);
});

test('calculateBackoff: exponential doubling', () => {
  const retry0 = calculateBackoff(0, 5000, 2, 0);
  const retry1 = calculateBackoff(1, 5000, 2, 0);
  const retry2 = calculateBackoff(2, 5000, 2, 0);

  expect(retry0).toBe(5000);
  expect(retry1).toBe(10000);
  expect(retry2).toBe(20000);
});

test('calculateBackoff: with jitter', () => {
  const results = new Set();

  // Run 100 times to ensure we get different values due to jitter
  for (let i = 0; i < 100; i++) {
    const result = calculateBackoff(0, 5000, 2, 10);
    results.add(result);
  }

  // With 10% jitter, we should get multiple different values
  expect(results.size).toBeGreaterThan(1);

  // All values should be within jitter range
  for (const result of results) {
    expect(result).toBeGreaterThanOrEqual(4500);
    expect(result).toBeLessThanOrEqual(5500);
  }
});

test('shouldRetry: returns true when under max', () => {
  const config: RetryConfig = {
    maxRetries: 3,
    initialTimeout: 5000,
    backoffMultiplier: 2,
    jitterPercentage: 10,
  };

  expect(shouldRetry(0, config)).toBe(true);
  expect(shouldRetry(1, config)).toBe(true);
  expect(shouldRetry(2, config)).toBe(true);
  expect(shouldRetry(3, config)).toBe(false);
});

test('getRetryDelay: returns correct delay', () => {
  const config: RetryConfig = {
    maxRetries: 3,
    initialTimeout: 5000,
    backoffMultiplier: 2,
    jitterPercentage: 0,
  };

  const delay0 = getRetryDelay(0, config);
  const delay1 = getRetryDelay(1, config);
  const delay2 = getRetryDelay(2, config);

  expect(delay0).toBe(5000);
  expect(delay1).toBe(10000);
  expect(delay2).toBe(20000);
});

test('sleep: waits for specified time', async () => {
  const start = Date.now();
  await sleep(100);
  const elapsed = Date.now() - start;

  expect(elapsed).toBeGreaterThanOrEqual(100);
  expect(elapsed).toBeLessThan(200); // Should be close to 100ms
});
