type EpisodeType = 'available' | 'vip' | 'svip' | 'teaser' | 'express' | 'preview' | 'locked';

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

  telegram?: {
    botToken: string;
    chatId: string;
  };
};

export const defaults: DefaultConfig = {
  check: {
    count: 3,
    checkInterval: 600,
    downloadTypes: ['available'],
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
