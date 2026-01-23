/**
 * Queue-based architecture types for wetvlo
 *
 * This module defines all types used by the queue system, including
 * queue items, configurations, and processor interfaces.
 */

import type { SeriesConfig } from '../types/config.types.js';
import type { Episode } from '../types/episode.types.js';

/**
 * Retry configuration with exponential backoff
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
  /** Default interval between checks in seconds */
  interval?: number;
  /** Default delay between downloads in seconds */
  downloadDelay?: number;
  /** Default number of checks for series */
  checks?: number;
  /** Default episode types to download */
  downloadTypes?: ('available' | 'vip' | 'teaser' | 'express' | 'preview' | 'locked')[];
  /** Retry configuration for this domain */
  retryConfig?: RetryConfig;
};

/**
 * Item in the check queue
 */
export type CheckQueueItem = {
  /** URL of the series to check */
  seriesUrl: string;
  /** Name of the series */
  seriesName: string;
  /** Configuration for this series */
  config: SeriesConfig;
  /** Current attempt number (1..config.checks) */
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
  /** Name of the series */
  seriesName: string;
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
 * Domain queue pair (check + download for a specific domain)
 */
export type DomainQueues = {
  /** Domain name */
  domain: string;
  /** Check queue for this domain */
  checkQueue: import('./check-queue.js').CheckQueue;
  /** Download queue for this domain */
  downloadQueue: import('./download-queue.js').DownloadQueue;
};
