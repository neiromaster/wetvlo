/**
 * Retry strategy with exponential backoff and jitter
 *
 * Implements exponential backoff with optional jitter to avoid
 * thundering herd problems when multiple operations fail simultaneously.
 */

import type { RetryConfig } from './types.js';

/**
 * Calculate exponential backoff with jitter
 *
 * @param retryCount - Current retry attempt (0-indexed)
 * @param initialTimeout - Initial timeout in milliseconds
 * @param backoffMultiplier - Multiplier for exponential backoff
 * @param jitterPercentage - Percentage of jitter (0-100)
 * @returns Delay in milliseconds before next retry
 *
 * @example
 * ```ts
 * // Retry 0: 5000ms + jitter
 * // Retry 1: 10000ms + jitter
 * // Retry 2: 20000ms + jitter
 * calculateBackoff(0, 5000, 2, 10);
 * ```
 */
export function calculateBackoff(
  retryCount: number,
  initialTimeout: number,
  backoffMultiplier: number,
  jitterPercentage: number,
): number {
  // Calculate base delay with exponential backoff
  const baseDelay = initialTimeout * backoffMultiplier ** retryCount;

  // Calculate jitter amount
  const jitterAmount = (baseDelay * jitterPercentage) / 100;

  // Generate random jitter within ±jitterAmount
  const jitter = (Math.random() * 2 - 1) * jitterAmount;

  // Calculate final delay (ensure non-negative)
  const finalDelay = Math.max(0, baseDelay + jitter);

  return Math.floor(finalDelay);
}

/**
 * Check if a retry should be attempted based on configuration
 *
 * @param retryCount - Current retry attempt
 * @param config - Retry configuration
 * @returns Whether to retry
 */
export function shouldRetry(retryCount: number, config: RetryConfig): boolean {
  return retryCount < config.maxRetries;
}

/**
 * Get the delay before the next retry
 *
 * @param retryCount - Current retry attempt
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function getRetryDelay(retryCount: number, config: RetryConfig): number {
  return calculateBackoff(retryCount, config.initialTimeout, config.backoffMultiplier, config.jitterPercentage);
}

/**
 * Sleep for a specified number of milliseconds
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 *
 * @param fn - Function to execute
 * @param config - Retry configuration
 * @param onRetry - Optional callback called before each retry
 * @returns Result of the function
 * @throws Last error if all retries exhausted
 *
 * @example
 * ```ts
 * await retryWithBackoff(
 *   async () => await fetchSomething(),
 *   retryConfig,
 *   (attempt, error) => console.log(`Retry ${attempt}:`, error.message)
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onRetry?: (attempt: number, error: Error) => void,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Sequential retry is intentional
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry after max attempts
      if (attempt >= config.maxRetries) {
        throw lastError;
      }

      // Calculate delay and wait
      const delay = getRetryDelay(attempt, config);

      if (onRetry) {
        onRetry(attempt, lastError);
      }

      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry failed');
}
