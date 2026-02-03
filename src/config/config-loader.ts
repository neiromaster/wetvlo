import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import type { Config, RawConfig } from '../config/config-schema.js';
import { ConfigError } from '../errors/custom-errors';
import { resolveEnvRecursive } from '../utils/env-resolver';
import { validateConfigWithWarnings } from './config-schema';

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

  const content = await readFile(absolutePath, 'utf-8');

  let rawConfig: RawConfig;

  try {
    rawConfig = yaml.load(content) as RawConfig;
  } catch (error) {
    throw new ConfigError(`Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Validate configuration structure and check for common mistakes
  validateConfigWithWarnings(rawConfig);

  // Resolve environment variables
  const config = resolveEnvRecursive(rawConfig) as unknown as Config;

  return config;
}

/**
 * Load config with defaults for optional fields
 */
export async function loadConfigWithDefaults(configPath: string = DEFAULT_CONFIG_PATH): Promise<Config> {
  return loadConfig(configPath);
}
