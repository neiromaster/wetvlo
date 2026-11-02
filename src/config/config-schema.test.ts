import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import {
  CheckSettingsSchema,
  ConfigSchema,
  DownloadSettingsSchema,
  type RawConfig,
  SeriesConfigSchema,
  TelegramConfigSchema,
  validateConfig,
  validateConfigSafe,
  validateConfigWithWarnings,
} from './config-schema.js';

describe('Config Schema', () => {
  const validConfig = {
    series: [
      {
        name: 'Test Series',
        url: 'https://wetv.vip/play/123',
        startTime: '10:00',
        check: {
          count: 5,
        },
      },
    ],
    domainConfigs: [
      {
        domain: 'wetv.vip',
        stateFile: 'state.json',
        check: {
          checkInterval: 60,
          downloadTypes: ['vip', 'available'],
        },
      },
    ],
    globalConfig: {
      stateFile: 'state.json',
    },
  };

  describe('CheckSettingsSchema', () => {
    it('should validate valid check settings', () => {
      const valid = {
        count: 1,
        checkInterval: 60,
        downloadTypes: ['vip', 'available'],
      };
      const result = CheckSettingsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should fail for non-positive numbers', () => {
      const invalid = {
        count: 0,
        checkInterval: -1,
      };
      const result = CheckSettingsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail for invalid download types', () => {
      const invalid = {
        downloadTypes: ['invalid-type'],
      };
      const result = CheckSettingsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('DownloadSettingsSchema', () => {
    it('should validate valid download settings', () => {
      const valid = {
        downloadDir: './downloads',
        downloadDelay: 1000,
        maxRetries: 3,
        initialTimeout: 5000,
        backoffMultiplier: 1.5,
        jitterPercentage: 10,
      };
      const result = DownloadSettingsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should fail for negative numbers', () => {
      const invalid = {
        downloadDelay: -1,
        maxRetries: -1,
      };
      const result = DownloadSettingsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail for jitter percentage > 100', () => {
      const invalid = {
        jitterPercentage: 101,
      };
      const result = DownloadSettingsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('SeriesConfigSchema', () => {
    it('should validate valid series config', () => {
      const valid = {
        name: 'Test Series',
        url: 'https://wetv.vip/play/123',
        startTime: '20:00',
      };
      const result = SeriesConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should fail for invalid URL', () => {
      const invalid = {
        name: 'Test Series',
        url: 'not-a-url',
        startTime: '20:00',
      };
      const result = SeriesConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail for invalid start time format', () => {
      // The current regex only checks for \d{1,2}:\d{2}, so '25:00' is technically valid format-wise
      const invalidTimes = ['10-00', '1:000', 'abc'];
      for (const time of invalidTimes) {
        const invalid = {
          name: 'Test Series',
          url: 'https://wetv.vip/play/123',
          startTime: time,
        };
        const result = SeriesConfigSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('cookiesFromBrowser', () => {
    it('accepts cookiesFromBrowser at series level', () => {
      const parsed = SeriesConfigSchema.parse({
        name: 'X',
        url: 'https://wetv.vip/play/1',
        cookiesFromBrowser: 'firefox:default-release-1',
      });
      expect(parsed.cookiesFromBrowser).toBe('firefox:default-release-1');
    });

    it('leaves cookiesFromBrowser undefined when not set', () => {
      const parsed = SeriesConfigSchema.parse({ name: 'X', url: 'https://wetv.vip/play/1' });
      expect(parsed.cookiesFromBrowser).toBeUndefined();
    });

    it('accepts an env placeholder (resolved before the spec is parsed)', () => {
      const parsed = SeriesConfigSchema.parse({
        name: 'X',
        url: 'https://wetv.vip/play/1',
        cookiesFromBrowser: '${WETVLO_PROFILE}',
      });
      expect(parsed.cookiesFromBrowser).toBe('${WETVLO_PROFILE}');
    });

    it('rejects non-firefox browser specs', () => {
      for (const spec of ['chrome:default', 'edge:Profile 1']) {
        const result = SeriesConfigSchema.safeParse({
          name: 'X',
          url: 'https://wetv.vip/play/1',
          cookiesFromBrowser: spec,
        });
        expect(result.success).toBe(false);
      }
    });

    it('rejects firefox spec without a profile', () => {
      const result = SeriesConfigSchema.safeParse({
        name: 'X',
        url: 'https://wetv.vip/play/1',
        cookiesFromBrowser: 'firefox',
      });
      expect(result.success).toBe(false);
    });

    it('rejects firefox spec with a blank profile', () => {
      const result = SeriesConfigSchema.safeParse({
        name: 'X',
        url: 'https://wetv.vip/play/1',
        cookiesFromBrowser: 'firefox: ',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('TelegramConfigSchema', () => {
    it('should validate valid telegram config', () => {
      const valid = {
        botToken: '123:abc',
        chatId: '123456',
      };
      const result = TelegramConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should fail if fields are missing', () => {
      const invalid = {
        botToken: '123:abc',
      };
      const result = TelegramConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('ConfigSchema', () => {
    it('should validate a correct configuration', () => {
      const result = ConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should fail if series is empty', () => {
      const invalidConfig = { ...validConfig, series: [] };
      const result = ConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Cannot be empty');
      }
    });

    // Note: stateFile is optional in domainConfigs after schema refactoring
    // This test is no longer relevant

    it('should reject unsupported cookiesFromBrowser specs', () => {
      const invalidConfig = {
        ...validConfig,
        globalConfig: { ...validConfig.globalConfig, cookiesFromBrowser: 'chrome:default' },
      };
      const result = ConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe('validateConfig', () => {
    it('should pass for valid config', () => {
      expect(() => validateConfig(validConfig as RawConfig)).not.toThrow();
    });

    it('should throw for invalid config', () => {
      const invalidConfig = {
        ...validConfig,
        globalConfig: { ...validConfig.globalConfig, cookiesFromBrowser: 'firefox' },
      };
      expect(() => validateConfig(invalidConfig as RawConfig)).toThrow();
    });
  });

  describe('validateConfigSafe', () => {
    it('should return success for valid config', () => {
      const result = validateConfigSafe(validConfig as RawConfig);
      expect(result.success).toBe(true);
    });

    it('should return error for invalid config', () => {
      const invalidConfig = {
        ...validConfig,
        globalConfig: { ...validConfig.globalConfig, cookiesFromBrowser: 'firefox' },
      };
      const result = validateConfigSafe(invalidConfig as RawConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
        expect(result.error).toContain('cookiesFromBrowser');
      }
    });
  });

  describe('legacy key deprecation warnings', () => {
    afterEach(() => {
      mock.restore();
    });

    const captureWarnings = (): string[] => {
      const calls: string[] = [];
      spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        calls.push(args.join(' '));
      });
      return calls;
    };

    it('warns when cookieFile is at the top level, in series or in domainConfigs', () => {
      const warnings = captureWarnings();
      validateConfigWithWarnings({
        cookieFile: './cookies.txt',
        series: [
          {
            name: 'Test Series',
            url: 'https://wetv.vip/play/123',
            cookieFile: './cookies.txt',
          },
        ],
        domainConfigs: [
          {
            domain: 'wetv.vip',
            cookieFile: './cookies.txt',
          },
        ],
      } as RawConfig);

      const text = warnings.join(' ');
      expect(text).toContain("'cookieFile' found in the top level is no longer supported");
      expect(text).toContain("'cookieFile' found in series[0] is no longer supported");
      expect(text).toContain("'cookieFile' found in domainConfigs[0] is no longer supported");
      expect(text).toContain('yt-dlp.conf');
    });

    it('warns that browser and playwrightHeadless have no effect', () => {
      const warnings = captureWarnings();
      validateConfigWithWarnings({
        series: [
          {
            name: 'Test Series',
            url: 'https://wetv.vip/play/123',
          },
        ],
        globalConfig: {
          browser: 'chrome',
          playwrightHeadless: true,
        },
      } as RawConfig);

      const text = warnings.join(' ');
      expect(text).toContain("'browser' found in globalConfig is no longer supported");
      expect(text).toContain("'playwrightHeadless' found in globalConfig is no longer supported");
      expect(text).toContain('no effect anymore');
    });

    it('does not warn about legacy keys for a clean config', () => {
      const warnings = captureWarnings();
      validateConfigWithWarnings({
        series: [
          {
            name: 'Test Series',
            url: 'https://wetv.vip/play/123',
          },
        ],
      } as RawConfig);

      const text = warnings.join(' ');
      expect(text).not.toContain('no longer supported');
    });
  });
});
