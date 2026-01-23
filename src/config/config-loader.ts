import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { ConfigError } from '../errors/custom-errors';
import type { Config, RawConfig } from '../types/config.types';
import { resolveEnvRecursive } from '../utils/env-resolver';
import { validateConfig } from './config-schema';

/**
 * Default config file path
 */
export const DEFAULT_CONFIG_PATH = './config.yaml';

/**
 * Load and parse configuration from YAML file
 *
 * @param configPath - Path to config file
 * @returns Parsed configuration
 * @throws ConfigError if file doesn't exist or is invalid
 */
export async function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): Promise<Config> {
  // Resolve relative path
  const absolutePath = join(process.cwd(), configPath);

  if (!existsSync(absolutePath)) {
    throw new ConfigError(
      `Configuration file not found: "${absolutePath}". Create a config.yaml file or specify a different path.`,
    );
  }

  const file = Bun.file(absolutePath);
  const content = await file.text();

  let rawConfig: RawConfig;

  try {
    rawConfig = yaml.load(content) as RawConfig;
  } catch (error) {
    throw new ConfigError(`Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Validate configuration structure
  validateConfig(rawConfig);

  // Resolve environment variables
  const config = resolveEnvRecursive(rawConfig) as unknown as Config;

  return config;
}

/**
 * Load config with defaults for optional fields
 */
export async function loadConfigWithDefaults(configPath: string = DEFAULT_CONFIG_PATH): Promise<Config> {
  const config = await loadConfig(configPath);

  // Set defaults for optional fields
  if (!config.telegram) {
    delete config.telegram;
  }

  return config;
}
