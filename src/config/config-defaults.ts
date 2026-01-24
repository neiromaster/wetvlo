/**
 * Default configuration values
 *
 * Centralized defaults for all configuration settings.
 * Used when no value is provided at series, domain, or global level.
 */

import { EpisodeType } from '../types/episode.types.js';
import type { CheckSettings, DownloadSettings } from './config-schema.js';

/**
 * Default check settings
 */
export const DEFAULT_CHECK_SETTINGS: Required<CheckSettings> = {
  count: 3, // Number of times to check for new episodes
  checkInterval: 600, // Seconds between checks
  downloadTypes: ['available'], // Episode types to download
};

/**
 * Default download settings
 */
export const DEFAULT_DOWNLOAD_SETTINGS: Required<DownloadSettings> = {
  downloadDir: './downloads',
  tempDir: './downloads', // Default temp dir same as download dir
  downloadDelay: 10, // Seconds between downloads
  maxRetries: 3, // Maximum retry attempts on failure
  initialTimeout: 5, // Initial retry delay in seconds
  backoffMultiplier: 2, // Exponential backoff multiplier
  jitterPercentage: 10, // Random jitter (0-100%)
  minDuration: 0, // Minimum duration in seconds (0 = disabled)
};

/**
 * Default episode types as EpisodeType enum
 */
export const DEFAULT_DOWNLOAD_TYPES_ENUM: EpisodeType[] = [EpisodeType.AVAILABLE, EpisodeType.VIP];

/**
 * Default download directory
 */
export const DEFAULT_DOWNLOAD_DIR = './downloads';
