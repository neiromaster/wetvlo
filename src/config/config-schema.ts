/**
 * Zod schemas for configuration validation
 *
 * This file defines both the validation schemas AND the TypeScript types.
 * Types are automatically inferred from the schemas, ensuring they stay in sync.
 */

import { z } from 'zod';

/**
 * Retry configuration with exponential backoff
 */
export const RetryConfigSchema = z.object({
  maxRetries: z.number().int().nonnegative(),
  initialTimeout: z.number().positive(), // seconds (changed from milliseconds in v2.0)
  backoffMultiplier: z.number().positive(),
  jitterPercentage: z.number().int().min(0).max(100),
});

export type RetryConfig = z.infer<typeof RetryConfigSchema>;

/**
 * Telegram notification configuration
 */
export const TelegramConfigSchema = z.object({
  botToken: z.string(),
  chatId: z.string(),
});

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

/**
 * Episode types
 */
const EpisodeTypeSchema = z.enum(['available', 'vip', 'teaser', 'express', 'preview', 'locked']);

/**
 * Domain-specific configuration
 */
export const DomainConfigSchema = z.object({
  domain: z.string(),
  interval: z.number().positive().optional(),
  downloadDelay: z.number().nonnegative().optional(),
  checks: z.number().positive().optional(),
  downloadTypes: z.array(EpisodeTypeSchema).optional(),
  retryConfig: RetryConfigSchema.optional(),
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
  checks: z.number().positive().optional(),
  interval: z.number().positive().optional(),
  downloadTypes: z.array(EpisodeTypeSchema).optional(),
  downloadDelay: z.number().nonnegative().optional(),
  retryConfig: RetryConfigSchema.optional(),
});

export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;

/**
 * Default series configuration
 */
export const SeriesDefaultsSchema = z.object({
  checks: z.number().positive().optional(),
  interval: z.number().positive().optional(),
  downloadDelay: z.number().nonnegative().optional(),
  downloadTypes: z.array(EpisodeTypeSchema).optional(),
  retryConfig: RetryConfigSchema.optional(),
});

export type SeriesDefaults = z.infer<typeof SeriesDefaultsSchema>;

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
  downloadDir: z.string(),
  stateFile: z.string(),
  browser: BrowserSchema,
  cookieFile: z.string().optional(),
  domainConfigs: z.array(DomainConfigSchema).optional(),
  seriesDefaults: SeriesDefaultsSchema.optional(),
  retryDefaults: RetryConfigSchema.optional(),
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
