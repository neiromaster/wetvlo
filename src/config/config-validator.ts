import { ConfigError } from '../errors/custom-errors';
import type { RawConfig } from '../types/config.types';
import { isValidUrl } from '../utils/url-utils';

/**
 * Validate configuration object
 *
 * @param rawConfig - Raw configuration object from YAML
 * @throws ConfigError if validation fails
 */
export function validateConfig(rawConfig: RawConfig): void {
  if (!rawConfig || typeof rawConfig !== 'object') {
    throw new ConfigError('Configuration must be an object');
  }

  // Validate series array
  if (!Array.isArray(rawConfig.series)) {
    throw new ConfigError('"series" must be an array');
  }

  if (rawConfig.series.length === 0) {
    throw new ConfigError('"series" array cannot be empty');
  }

  // Validate each series
  for (let i = 0; i < rawConfig.series.length; i++) {
    const series = rawConfig.series[i] as Record<string, unknown>;

    if (!series.url || typeof series.url !== 'string') {
      throw new ConfigError(`Series #${i + 1}: "url" is required and must be a string`);
    }

    if (!isValidUrl(series.url)) {
      throw new ConfigError(`Series #${i + 1}: "url" must be a valid URL`);
    }

    if (!series.startTime || typeof series.startTime !== 'string') {
      throw new ConfigError(`Series #${i + 1}: "startTime" is required and must be a string (HH:MM format)`);
    }

    // Validate time format
    if (!/^\d{1,2}:\d{2}$/.test(series.startTime)) {
      throw new ConfigError(`Series #${i + 1}: "startTime" must be in HH:MM format (e.g., "20:00")`);
    }

    if (typeof series.checks !== 'number' || series.checks <= 0) {
      throw new ConfigError(`Series #${i + 1}: "checks" must be a positive number`);
    }

    if (typeof series.interval !== 'number' || series.interval <= 0) {
      throw new ConfigError(`Series #${i + 1}: "interval" must be a positive number (seconds)`);
    }
  }

  // Validate telegram config if present
  if (rawConfig.telegram) {
    const telegram = rawConfig.telegram as Record<string, unknown>;

    if (!telegram.botToken || typeof telegram.botToken !== 'string') {
      throw new ConfigError('Telegram config: "botToken" is required and must be a string');
    }

    if (!telegram.chatId || typeof telegram.chatId !== 'string') {
      throw new ConfigError('Telegram config: "chatId" is required and must be a string');
    }
  }

  // Validate downloadDir
  if (!rawConfig.downloadDir || typeof rawConfig.downloadDir !== 'string') {
    throw new ConfigError('"downloadDir" is required and must be a string');
  }

  // Validate stateFile
  if (!rawConfig.stateFile || typeof rawConfig.stateFile !== 'string') {
    throw new ConfigError('"stateFile" is required and must be a string');
  }

  // Validate browser
  if (!rawConfig.browser || typeof rawConfig.browser !== 'string') {
    throw new ConfigError('"browser" is required and must be a string');
  }

  const validBrowsers = ['chrome', 'firefox', 'safari', 'chromium', 'edge'];
  if (!validBrowsers.includes(rawConfig.browser)) {
    throw new ConfigError(`"browser" must be one of: ${validBrowsers.join(', ')}`);
  }
}
