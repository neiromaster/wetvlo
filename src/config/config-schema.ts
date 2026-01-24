/**
 * Zod schemas for configuration validation
 *
 * This file defines both the validation schemas AND the TypeScript types.
 * Types are automatically inferred from the schemas, ensuring they stay in sync.
 */

import { z } from 'zod';

/**
 * Episode types
 */
const EpisodeTypeSchema = z.enum(['available', 'vip', 'teaser', 'express', 'preview', 'locked']);

/**
 * Check settings for series/domain
 */
export const CheckSettingsSchema = z.object({
  count: z.number().positive().optional(),
  checkInterval: z.number().positive().optional(),
  downloadTypes: z.array(EpisodeTypeSchema).optional(),
});

export type CheckSettings = z.infer<typeof CheckSettingsSchema>;

/**
 * Download settings for series/domain
 */
export const DownloadSettingsSchema = z.object({
  downloadDir: z.string().optional(),
  tempDir: z.string().optional(),
  downloadDelay: z.number().nonnegative().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  initialTimeout: z.number().positive().optional(),
  backoffMultiplier: z.number().positive().optional(),
  jitterPercentage: z.number().int().min(0).max(100).optional(),
  minDuration: z.number().nonnegative().optional(),
});

export type DownloadSettings = z.infer<typeof DownloadSettingsSchema>;

/**
 * Telegram notification configuration
 */
export const TelegramConfigSchema = z.object({
  botToken: z.string(),
  chatId: z.string(),
});

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

/**
 * Domain-specific configuration
 */
export const DomainConfigSchema = z.object({
  domain: z.string(),
  check: CheckSettingsSchema.optional(),
  download: DownloadSettingsSchema.optional(),
});

export type DomainConfig = z.infer<typeof DomainConfigSchema>;

/**
 * Series configuration
 */
export const SeriesConfigSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/, {
    message: 'Must be in HH:MM format (e.g., "20:00")',
  }),
  check: CheckSettingsSchema.optional(),
  download: DownloadSettingsSchema.optional(),
});

export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;

/**
 * Global configuration defaults
 */
export const GlobalConfigsSchema = z.object({
  check: CheckSettingsSchema.optional(),
  download: DownloadSettingsSchema.optional(),
});

export type GlobalConfigs = z.infer<typeof GlobalConfigsSchema>;

/**
 * Browser options
 */
const BrowserSchema = z.enum(['chrome', 'firefox', 'safari', 'chromium', 'edge']);

/**
 * Main configuration schema
 */
export const ConfigSchema = z.object({
  series: z.array(SeriesConfigSchema).min(1, 'Cannot be empty'),
  telegram: TelegramConfigSchema.optional(),
  globalConfigs: GlobalConfigsSchema.optional(),
  stateFile: z.string(),
  browser: BrowserSchema,
  cookieFile: z.string().optional(),
  domainConfigs: z.array(DomainConfigSchema).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Raw configuration before env var resolution
 */
export type RawConfig = Record<string, unknown>;

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
