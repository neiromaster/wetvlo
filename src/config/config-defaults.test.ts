import { describe, expect, it } from 'bun:test';
import { EpisodeType } from '../types/episode.types.js';
import {
  DEFAULT_CHECK_SETTINGS,
  DEFAULT_DOWNLOAD_DIR,
  DEFAULT_DOWNLOAD_SETTINGS,
  DEFAULT_DOWNLOAD_TYPES_ENUM,
} from './config-defaults.js';

describe('Config Defaults', () => {
  it('should have correct default check settings', () => {
    expect(DEFAULT_CHECK_SETTINGS).toEqual({
      count: 3,
      checkInterval: 60,
      downloadTypes: ['available', 'vip'],
    });
  });

  it('should have correct default download settings', () => {
    expect(DEFAULT_DOWNLOAD_SETTINGS).toEqual({
      downloadDir: './downloads',
      downloadDelay: 5,
      maxRetries: 3,
      initialTimeout: 5,
      backoffMultiplier: 2,
      jitterPercentage: 10,
      minDuration: 0,
    });
  });

  it('should have correct default download types enum', () => {
    expect(DEFAULT_DOWNLOAD_TYPES_ENUM).toEqual([EpisodeType.AVAILABLE, EpisodeType.VIP]);
  });

  it('should have correct default download directory', () => {
    expect(DEFAULT_DOWNLOAD_DIR).toBe('./downloads');
  });
});
