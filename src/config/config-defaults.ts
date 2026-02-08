import { NotificationLevel } from '../notifications/notification-level';
import { EpisodeType } from '../types/episode-type';

export type DefaultConfig = {
  stateFile: string;
  browser?: string;
  cookieFile?: string;
  cookieRefreshBrowser?: string;
  playwrightHeadless?: boolean;

  check: {
    count: number;
    checkInterval: number;
    downloadTypes: EpisodeType[];
  };

  download: {
    downloadDir: string;
    tempDir: string;
    downloadDelay: number;
    maxRetries: number;
    initialTimeout: number;
    backoffMultiplier: number;
    jitterPercentage: number;
    minDuration: number;
  };

  notifications: {
    consoleMinLevel: NotificationLevel;
  };

  telegram?: {
    minLevel: NotificationLevel;
  };
};

export const defaults: DefaultConfig = {
  check: {
    count: 3,
    checkInterval: 600,
    downloadTypes: [EpisodeType.AVAILABLE],
  },
  download: {
    downloadDir: './downloads',
    tempDir: './downloads',
    downloadDelay: 10,
    maxRetries: 3,
    initialTimeout: 5,
    backoffMultiplier: 2,
    jitterPercentage: 10,
    minDuration: 0,
  },
  telegram: {
    minLevel: NotificationLevel.ERROR,
  },
  notifications: {
    consoleMinLevel: NotificationLevel.INFO,
  },
  stateFile: 'wetvlo-state.json',
  browser: 'chrome',
  playwrightHeadless: true,
};

/**
 * Default configuration values
 */
export function getDefaults() {
  return defaults;
}
