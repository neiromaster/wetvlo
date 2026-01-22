/**
 * Configuration for a single series to monitor
 */
export type SeriesConfig = {
  /** URL of the series page */
  url: string;
  /** Time to start checking (HH:MM format) */
  startTime: string;
  /** Number of times to check for new episodes */
  checks: number;
  /** Interval between checks in seconds */
  interval: number;
};

/**
 * Telegram notification configuration
 */
export type TelegramConfig = {
  /** Bot token (supports ${VAR_NAME} env variable syntax) */
  botToken: string;
  /** Chat ID to send notifications to */
  chatId: string;
};

/**
 * Main configuration structure
 */
export type Config = {
  /** List of series to monitor */
  series: SeriesConfig[];
  /** Telegram configuration for error notifications */
  telegram?: TelegramConfig;
  /** Directory to save downloaded videos */
  downloadDir: string;
  /** Path to state file */
  stateFile: string;
  /** Browser to extract cookies from */
  browser: 'chrome' | 'firefox' | 'safari' | 'chromium' | 'edge';
  /** Optional: manual cookie file path */
  cookieFile?: string;
};

/**
 * Raw configuration from YAML (before env var resolution)
 */
export type RawConfig = Record<string, unknown>;
