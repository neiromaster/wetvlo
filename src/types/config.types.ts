/**
 * Configuration types
 *
 * All types are automatically inferred from Zod schemas in config-schema.ts
 * to ensure validation and types stay in sync.
 */

export type {
  Config,
  DomainConfig,
  RetryConfig,
  SeriesConfig,
  SeriesDefaults,
  TelegramConfig,
} from '../config/config-schema.js';

/**
 * Scheduler mode
 */
export type SchedulerMode = 'scheduled' | 'once';

/**
 * Scheduler options
 */
export type SchedulerOptions = {
  mode: SchedulerMode;
};

/**
 * Raw configuration from YAML (before env var resolution)
 * Re-exported from config-schema for convenience
 */
export type { RawConfig } from '../config/config-schema.js';
