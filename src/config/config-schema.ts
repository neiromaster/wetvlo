/**
 * Zod schemas for configuration validation
 *
 * This file defines both the validation schemas AND the TypeScript types.
 * Types are automatically inferred from the schemas, ensuring they stay in sync.
 */

import { z } from 'zod';
import { NotificationLevelSchema } from '../notifications/notification-level';
import { EpisodeTypeSchema } from '../types/episode-type';
import type { DeepMerge } from '../utils/deep-merge';
import type { DefaultConfig } from './config-defaults';

/**
 * Check settings for series/domain
 */
export const CheckSettingsSchema = z.object({
  count: z.number().positive().optional().describe('Number of episodes to check'),
  checkInterval: z.number().positive().optional().describe('Interval between checks in seconds'),
  downloadTypes: z.array(EpisodeTypeSchema).optional().describe('Episode types to download'),
});

export type CheckSettings = z.infer<typeof CheckSettingsSchema>;

export type CheckSettingsResolved = DeepMerge<DefaultConfig['check'], CheckSettings>;
/**
 * Download settings for series/domain
 */
export const DownloadSettingsSchema = z.object({
  downloadDir: z.string().optional().describe('Directory to save downloaded episodes'),
  tempDir: z.string().optional().describe('Directory for temporary files'),
  downloadDelay: z.number().nonnegative().optional().describe('Delay between downloads in milliseconds'),
  maxRetries: z.number().int().nonnegative().optional().describe('Maximum number of retry attempts'),
  initialTimeout: z.number().positive().optional().describe('Initial timeout for operations in milliseconds'),
  backoffMultiplier: z.number().positive().optional().describe('Multiplier for exponential backoff'),
  jitterPercentage: z.number().int().min(0).max(100).optional().describe('Jitter percentage for retry delays'),
  minDuration: z.number().nonnegative().optional().describe('Minimum duration in seconds for downloads'),
});

export type DownloadSettings = z.infer<typeof DownloadSettingsSchema>;

export type DownloadSettingsResolved = DeepMerge<DefaultConfig['download'], DownloadSettings>;

/**
 * Telegram notification configuration
 */
export const TelegramConfigSchema = z.object({
  botToken: z.string().describe('Telegram bot token'),
  chatId: z.string().describe('Telegram chat ID'),
  minLevel: NotificationLevelSchema.optional().describe('Minimum notification level for Telegram'),
});

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

/**
 * Browser options
 */
const BrowserSchema = z.enum(['chrome', 'firefox', 'safari', 'chromium', 'edge']);

const CommonSettingsSchema = z.object({
  check: CheckSettingsSchema.optional().describe('Check settings'),
  download: DownloadSettingsSchema.optional().describe('Download settings'),
  notifications: z
    .object({
      consoleMinLevel: NotificationLevelSchema.optional().describe('Minimum notification level for console output'),
    })
    .optional()
    .describe('Notification settings'),
  telegram: TelegramConfigSchema.optional().describe('Telegram notification configuration'),
  stateFile: z.string().optional().describe('Path to state file'),
  browser: BrowserSchema.optional().describe('Browser to use for scraping'),
  cookieFile: z.string().optional().describe('Path to cookie file'),
  subLangs: z.array(z.string()).optional().describe('List of subtitle languages to download'),
  cookieRefreshBrowser: BrowserSchema.optional().describe('Browser to use for Playwright cookie refresh'),
  playwrightHeadless: z.boolean().optional().describe('Run Playwright browser in headless mode'),
});

/**
 * Global configuration defaults
 */
export const GlobalConfigSchema = CommonSettingsSchema;

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export type GlobalConfigResolved = DeepMerge<DefaultConfig, GlobalConfig>;

/**
 * Domain-specific configuration
 */
export const DomainConfigSchema = CommonSettingsSchema.extend({
  domain: z.string().describe('Domain name (e.g., "weTV")'),
});

export type DomainConfig = z.infer<typeof DomainConfigSchema>;

export type DomainConfigResolved = DeepMerge<GlobalConfigResolved, DomainConfig>;

/**
 * Series configuration
 */
export const SeriesConfigSchema = CommonSettingsSchema.extend({
  name: z.string().describe('Series name'),
  url: z.url().describe('Series URL'),
  startTime: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/, {
      message: 'Must be in HH:MM format (e.g., "20:00")',
    })
    .optional()
    .describe('Start time in HH:MM format'),
  cron: z.string().optional().describe('Cron expression for scheduling'),
});

export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;

export type SeriesConfigResolved = DeepMerge<DomainConfigResolved, SeriesConfig>;

/**
 * Main configuration schema
 */
export const ConfigSchema = z.object({
  series: z.array(SeriesConfigSchema).min(1, 'Cannot be empty').describe('List of series to monitor'),
  domainConfigs: z.array(DomainConfigSchema).optional().describe('Domain-specific configurations'),
  globalConfig: GlobalConfigSchema.optional().describe('Global configuration defaults'),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Raw configuration before env var resolution
 */
export type RawConfig = Record<string, unknown>;

/**
 * Configuration level for resolution
 */
export type Level = 'global' | 'domain' | 'series';

/**
 * Resolved configuration type based on level
 */
export type ResolvedConfig<L extends Level> = L extends 'global'
  ? GlobalConfigResolved
  : L extends 'domain'
    ? DomainConfigResolved
    : SeriesConfigResolved;

/**
 * Validate configuration and check for common mistakes
 *
 * @param rawConfig - Raw configuration object from YAML
 * @throws ConfigError if validation fails or common mistakes are found
 */
export function validateConfigWithWarnings(rawConfig: RawConfig): void {
  // First, do the basic validation
  ConfigSchema.parse(rawConfig);

  // Then check for common configuration mistakes
  const warnings: string[] = [];

  // Check for misplaced download settings
  if (rawConfig.globalConfig) {
    // biome-ignore lint/suspicious/noExplicitAny: warnings for migrated config
    const globalConfig = rawConfig.globalConfig as any;

    // Check if downloadDir or tempDir are directly under globalConfig
    if (globalConfig.downloadDir && !globalConfig.download?.downloadDir) {
      warnings.push(
        `'downloadDir' found directly under 'globalConfig'. ` +
          `It should be placed under 'globalConfig.download'. ` +
          `Current value: "${globalConfig.downloadDir}"`,
      );
    }

    if (globalConfig.tempDir && !globalConfig.download?.tempDir) {
      warnings.push(
        `'tempDir' found directly under 'globalConfig'. ` +
          `It should be placed under 'globalConfig.download'. ` +
          `Current value: "${globalConfig.tempDir}"`,
      );
    }

    // Check for misplaced check settings
    if (globalConfig.count && !globalConfig.check?.count) {
      warnings.push(
        `'count' found directly under 'globalConfig'. ` + `It should be placed under 'globalConfig.check'.`,
      );
    }

    if (globalConfig.checkInterval && !globalConfig.check?.checkInterval) {
      warnings.push(
        `'checkInterval' found directly under 'globalConfig'. ` + `It should be placed under 'globalConfig.check'.`,
      );
    }
  }

  // Check for common typo: globalConfigs instead of globalConfig
  if ((rawConfig as Record<string, unknown>).globalConfigs) {
    warnings.push(`'globalConfigs' found. Did you mean 'globalConfig'?`);
  }

  // Check for misplaced settings in domain configs
  if (rawConfig.domainConfigs && Array.isArray(rawConfig.domainConfigs)) {
    rawConfig.domainConfigs.forEach((domainConfig: Record<string, unknown>, index: number) => {
      if (domainConfig.downloadDir && !(domainConfig.download as Record<string, unknown> | undefined)?.downloadDir) {
        warnings.push(
          `'downloadDir' found directly under 'domainConfigs[${index}]. ` +
            `It should be placed under 'domainConfigs[${index}].download'.`,
        );
      }
    });
  }

  // If there are warnings, log them
  if (warnings.length > 0) {
    console.warn('\n⚠️  Configuration Warnings:');
    console.warn('The following configuration issues were detected:');
    warnings.forEach((warning, index) => {
      console.warn(`${index + 1}. ${warning}`);
    });
    console.warn('Please fix these issues in your config.yaml file.\n');
  }
}

/**
 * Validate configuration using Zod
 *
 * @param rawConfig - Raw configuration object from YAML
 * @throws z.ZodError if validation fails
 */
export function validateConfig(rawConfig: RawConfig): void {
  ConfigSchema.parse(rawConfig);
}

/**
 * Validate with custom error formatting
 *
 * @param rawConfig - Raw configuration object
 * @returns Object with { success: boolean, error?: string }
 */
export function validateConfigSafe(rawConfig: RawConfig): { success: true } | { success: false; error: string } {
  try {
    ConfigSchema.parse(rawConfig);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: formatZodError(error) };
    }
    return { success: false, error: String(error) };
  }
}

/**
 * Format Zod error into a readable message
 */
function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'value';
      const code = issue.code.toUpperCase();
      return `${path} ${issue.message} [${code}]`;
    })
    .join('; ');
}
