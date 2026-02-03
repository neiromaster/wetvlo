import { describe, expect, it } from 'bun:test';
import { extractDownloadOptions } from '../downloader/download-options.js';
import { ConfigRegistry } from './config-registry.js';
import type { Config, SeriesConfig } from './config-schema.js';
import { validateConfigWithWarnings } from './config-schema.js';

describe('Windows Integration Tests', () => {
  const mockSeries: SeriesConfig = {
    name: 'Test Series',
    url: 'https://example.com/series',
    startTime: '20:00',
  };

  describe('Windows User Scenarios', () => {
    it('should handle typical Russian Windows user setup', () => {
      const config: Config = {
        series: [
          {
            name: 'Мой Китайский Сериал',
            url: 'https://wetv.vip/my-series',
            startTime: '20:00',
          },
        ],
        globalConfig: {
          download: {
            downloadDir: 'D:\\Сериалы\\Китайские',
            tempDir: 'C:\\Users\\Пользователь\\AppData\\Local\\Temp',
          },
          stateFile: 'D:\\Сериалы\\wetvlo-state.json',
          cookieFile: 'D:\\Сериалы\\cookies.txt',
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve('https://wetv.vip/my-series', 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('D:\\Сериалы\\Китайские');
      expect(downloadOptions.tempDir).toBe('C:\\Users\\Пользователь\\AppData\\Local\\Temp');
      expect(resolved.stateFile).toBe('D:\\Сериалы\\wetvlo-state.json');
    });

    it('should handle Windows portable installation on USB drive', () => {
      const config: Config = {
        series: [
          {
            name: 'Portable Series',
            url: 'https://example.com/portable',
            startTime: '20:00',
          },
        ],
        globalConfig: {
          download: {
            downloadDir: 'E:\\Downloads\\Series',
            tempDir: 'E:\\Temp',
          },
          stateFile: '.\\wetvlo-state.json',
          cookieFile: '.\\cookies.txt',
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve('https://example.com/portable', 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('E:\\Downloads\\Series');
      expect(downloadOptions.tempDir).toBe('E:\\Temp');
      expect(resolved.stateFile).toBe('.\\wetvlo-state.json');
    });

    it('should handle Windows with network storage', () => {
      const config: Config = {
        series: [
          {
            name: 'Network Series',
            url: 'https://example.com/network',
            startTime: '20:00',
          },
        ],
        globalConfig: {
          download: {
            downloadDir: '\\\\NAS\\Media\\Downloads',
            tempDir: '\\\\NAS\\Temp\\wetvlo',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve('https://example.com/network', 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('\\\\NAS\\Media\\Downloads');
      expect(downloadOptions.tempDir).toBe('\\\\NAS\\Temp\\wetvlo');
    });
  });

  describe('Windows Configuration Validation', () => {
    it('should detect common Windows configuration mistakes', () => {
      const consoleSpy = {
        calls: [] as string[],
        log: (...args: any[]) => {
          consoleSpy.calls.push(args.join(' '));
        },
      };
      const originalWarn = console.warn;
      console.warn = consoleSpy.log;

      const wrongConfig = {
        series: [
          {
            name: 'Test Series',
            url: 'https://example.com/series',
            startTime: '20:00',
          },
        ],
        globalConfig: {
          downloadDir: 'C:\\Wrong\\Place', // WRONG: should be under download
          tempDir: '.\\temp', // WRONG: should be under download
          count: 3, // WRONG: should be under check
        },
      };

      expect(() => validateConfigWithWarnings(wrongConfig)).not.toThrow();

      expect(consoleSpy.calls.length).toBeGreaterThan(0);
      const warningCalls = consoleSpy.calls.join(' ');

      expect(warningCalls).toContain('⚠️  Configuration Warnings:');
      expect(warningCalls).toContain("'downloadDir' found directly under 'globalConfig'");
      expect(warningCalls).toContain("'tempDir' found directly under 'globalConfig'");
      expect(warningCalls).toContain("'count' found directly under 'globalConfig'");

      console.warn = originalWarn;
    });
  });

  describe('Windows Path Compatibility', () => {
    it('should handle mixed slash formats', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:/Mixed/Format\\Path/Downloads',
            tempDir: '.\\temp\\mixed/format',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('C:/Mixed/Format\\Path/Downloads');
      expect(downloadOptions.tempDir).toBe('.\\temp\\mixed/format');
    });

    it('should handle Windows environment variables', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: '%USERPROFILE%\\Downloads\\Series',
            tempDir: '%TEMP%\\wetvlo',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('%USERPROFILE%\\Downloads\\Series');
      expect(downloadOptions.tempDir).toBe('%TEMP%\\wetvlo');
    });
  });

  describe('Windows Multi-Series Setup', () => {
    it('should handle multiple series with different Windows paths', () => {
      const config: Config = {
        series: [
          {
            name: 'WeTV Series',
            url: 'https://wetv.vip/series1',
            startTime: '20:00',
            download: {
              downloadDir: 'D:\\Media\\WeTV\\Series1',
              tempDir: '.\\temp\\wetv1',
            },
          },
          {
            name: 'iQIYI Series',
            url: 'https://iqiyi.com/series2',
            startTime: '21:00',
            download: {
              downloadDir: 'D:\\Media\\iQIYI\\Series2',
              tempDir: '.\\temp\\iqiyi2',
            },
          },
        ],
        domainConfigs: [
          {
            domain: 'wetv.vip',
            download: {
              downloadDelay: 15,
              maxRetries: 5,
            },
          },
          {
            domain: 'iqiyi.com',
            download: {
              downloadDelay: 20,
              maxRetries: 3,
            },
          },
        ],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\Default',
            tempDir: '.\\temp',
            downloadDelay: 10,
            maxRetries: 3,
          },
        },
      };

      const registry = new ConfigRegistry(config);

      // Test WeTV series
      const resolved1 = registry.resolve('https://wetv.vip/series1', 'series');
      const downloadOptions1 = extractDownloadOptions(resolved1);
      expect(downloadOptions1.downloadDir).toBe('D:\\Media\\WeTV\\Series1');
      expect(downloadOptions1.tempDir).toBe('.\\temp\\wetv1');

      // Test iQIYI series
      const resolved2 = registry.resolve('https://iqiyi.com/series2', 'series');
      const downloadOptions2 = extractDownloadOptions(resolved2);
      expect(downloadOptions2.downloadDir).toBe('D:\\Media\\iQIYI\\Series2');
      expect(downloadOptions2.tempDir).toBe('.\\temp\\iqiyi2');
    });
  });

  describe('Windows Edge Cases', () => {
    it('should handle paths with special Windows characters', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\My Series (2023)',
            tempDir: '.\\temp\\test@series',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('C:\\Downloads\\My Series (2023)');
      expect(downloadOptions.tempDir).toBe('.\\temp\\test@series');
    });

    it('should handle very deep Windows paths', () => {
      const deepPath = `C:\\${'VeryDeep\\'.repeat(20)}Downloads`;
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: deepPath,
            tempDir: '.\\temp',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe(deepPath);
      expect(downloadOptions.downloadDir.length).toBeGreaterThan(150);
    });
  });
});
