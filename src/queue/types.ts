/**
 * Queue-based architecture types for wetvlo
 *
 * This module defines all types used by the queue system, including
 * queue items, configurations, and processor interfaces.
 */

import type { Episode } from '../types/episode.types.js';

/**
 * Check settings for queue behavior
 */
export type CheckSettings = {
  /** Number of checks to perform for a series */
  count?: number;
  /** Interval between checks in seconds */
  checkInterval?: number;
  /** Episode types to download */
  downloadTypes?: ('available' | 'vip' | 'teaser' | 'express' | 'preview' | 'locked')[];
};

/**
 * Download settings for queue behavior
 */
export type DownloadSettings = {
  /** Directory to download episodes to */
  downloadDir?: string;
  /** Delay between downloads in seconds */
  downloadDelay?: number;
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Initial timeout in seconds */
  initialTimeout?: number;
  /** Multiplier for exponential backoff (e.g., 2 = double each time) */
  backoffMultiplier?: number;
  /** Percentage of jitter to add (0-100) to avoid thundering herd */
  jitterPercentage?: number;
  /** Minimum duration in seconds (0 = disabled) */
  minDuration?: number;
};

/**
 * Retry configuration with exponential backoff
 * @deprecated Use DownloadSettings instead
 */
export type RetryConfig = {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial timeout in seconds */
  initialTimeout: number;
  /** Multiplier for exponential backoff (e.g., 2 = double each time) */
  backoffMultiplier: number;
  /** Percentage of jitter to add (0-100) to avoid thundering herd */
  jitterPercentage: number;
};

/**
 * Domain-specific configuration for queue behavior
 */
export type DomainConfig = {
  /** Domain name (e.g., "wetv.vip", "iqiyi.com") */
  domain: string;
  /** Check settings */
  check?: CheckSettings;
  /** Download settings */
  download?: DownloadSettings;
};

/**
 * Item in the check queue
 */
export type CheckQueueItem = {
  /** URL of the series to check */
  seriesUrl: string;
  /** Current attempt number (1..config.check.count) */
  attemptNumber: number;
  /** Current retry count for errors */
  retryCount?: number;
  /** Timestamp when this check should occur */
  scheduledTime?: Date;
};

/**
 * Item in the download queue
 */
export type DownloadQueueItem = {
  /** URL of the series */
  seriesUrl: string;
  /** Episode to download */
  episode: Episode;
  /** Timestamp when this download should occur */
  scheduledTime?: Date;
  /** Current retry count for errors */
  retryCount?: number;
};

/**
 * Generic queue processor function
 */
export type QueueProcessor<T> = (item: T) => Promise<void>;

/**
 * Queue status information
 */
export type QueueStatus = {
  /** Number of items currently in the queue */
  queueLength: number;
  /** Whether the queue is currently processing an item */
  isProcessing: boolean;
  /** Number of items processed total */
  processedCount: number;
  /** Number of items that failed */
  failedCount: number;
};

/**
 * Result of a check operation
 */
export type CheckResult = {
  /** Whether new episodes were found */
  hasNewEpisodes: boolean;
  /** Episodes that were found (if any) */
  episodes: Episode[];
  /** Whether to requeue this series for another check */
  shouldRequeue: boolean;
  /** Delay before next check in milliseconds (if requeueing) */
  requeueDelay?: number;
};

/**
 * Result of a download operation
 */
export type DownloadResult = {
  /** Whether the download was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Whether to retry the download */
  shouldRetry: boolean;
  /** Delay before retry in milliseconds (if retrying) */
  retryDelay?: number;
};

/**
 * Task item wrapper with metadata
 */
export type TaskItem<T> = {
  /** Task data */
  data: T;
  /** When the task was added to the queue */
  addedAt: Date;
};

/**
 * Universal scheduler configuration
 */
export type SchedulerConfig = {
  /** Optional global cooldown between tasks (milliseconds) */
  globalCooldownMs?: number;
};

/**
 * Executor callback for universal scheduler
 */
export type ExecutorCallback<T> = (task: T, queueName: string) => Promise<void>;

/**
 * Combined task type for universal scheduler
 */
export type ScheduledTask = CheckQueueItem | DownloadQueueItem;
