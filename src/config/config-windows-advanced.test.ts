import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as yaml from 'js-yaml';
import { extractDownloadOptions } from '../downloader/download-options.js';
import { ConfigRegistry } from './config-registry.js';
import type { Config, SeriesConfig } from './config-schema.js';
import { validateConfigWithWarnings } from './config-schema.js';

describe('Windows Advanced Tests', () => {
  const mockSeries: SeriesConfig = {
    name: 'Test Series',
    url: 'https://example.com/series',
    startTime: '20:00',
  };

  describe('Windows Path Edge Cases', () => {
    it('should handle paths with Unicode characters', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\Сериалы',
            tempDir: '.\\temp\\中文',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('C:\\Downloads\\Сериалы');
      expect(downloadOptions.tempDir).toBe('.\\temp\\中文');
    });

    it('should handle paths with reserved Windows names', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\CON\\Series',
            tempDir: '.\\temp\\PRN',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('C:\\Downloads\\CON\\Series');
      expect(downloadOptions.tempDir).toBe('.\\temp\\PRN');
    });

    it('should handle paths with dots and special characters', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\My.Series.2023',
            tempDir: '.\\temp\\test@series#1',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('C:\\Downloads\\My.Series.2023');
      expect(downloadOptions.tempDir).toBe('.\\temp\\test@series#1');
    });
  });

  describe('Windows Configuration Hierarchy', () => {
    it('should handle complex Windows configuration hierarchy', () => {
      const config: Config = {
        series: [
          {
            name: 'Series 1',
            url: 'https://wetv.vip/series1',
            startTime: '20:00',
            download: {
              downloadDir: 'C:\\Series\\Series1\\Downloads',
              tempDir: '.\\temp\\series1',
            },
          },
          {
            name: 'Series 2',
            url: 'https://wetv.vip/series2',
            startTime: '21:00',
            // Should inherit from domain
          },
        ],
        domainConfigs: [
          {
            domain: 'wetv.vip',
            download: {
              downloadDir: 'D:\\Media\\WeTV',
              tempDir: 'D:\\Temp\\WeTV',
              maxRetries: 5,
            },
          },
        ],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\Default',
            tempDir: '.\\temp',
            maxRetries: 3,
            downloadDelay: 10,
          },
        },
      };

      const registry = new ConfigRegistry(config);

      // Series 1 should use its own config
      const resolved1 = registry.resolve('https://wetv.vip/series1', 'series');
      const downloadOptions1 = extractDownloadOptions(resolved1);
      expect(downloadOptions1.downloadDir).toBe('C:\\Series\\Series1\\Downloads');
      expect(downloadOptions1.tempDir).toBe('.\\temp\\series1');

      // Series 2 should inherit from domain
      const resolved2 = registry.resolve('https://wetv.vip/series2', 'series');
      const downloadOptions2 = extractDownloadOptions(resolved2);
      expect(downloadOptions2.downloadDir).toBe('D:\\Media\\WeTV');
      expect(downloadOptions2.tempDir).toBe('D:\\Temp\\WeTV');
    });
  });

  describe('Windows Configuration Validation', () => {
    it('should detect multiple Windows configuration issues', () => {
      const consoleSpy = {
        calls: [] as string[],
        log: (...args: any[]) => {
          consoleSpy.calls.push(args.join(' '));
        },
      };
      const originalWarn = console.warn;
      console.warn = consoleSpy.log;

      const malformedConfig = {
        series: [
          {
            name: 'Test Series',
            url: 'https://example.com/series',
            startTime: '20:00',
            downloadDir: 'C:\\Wrong\\Place', // WRONG: should be under download
          },
        ],
        domainConfigs: [
          {
            domain: 'example.com',
            downloadDir: 'D:\\Wrong\\Domain', // WRONG: should be under download
          },
        ],
        globalConfig: {
          downloadDir: 'C:\\Wrong\\Global', // WRONG: should be under download
          tempDir: '.\\temp', // WRONG: should be under download
          count: 5, // WRONG: should be under check
        },
      };

      expect(() => validateConfigWithWarnings(malformedConfig)).not.toThrow();

      expect(consoleSpy.calls.length).toBeGreaterThan(0);
      const warningCalls = consoleSpy.calls.join(' ');

      expect(warningCalls).toContain('⚠️  Configuration Warnings:');
      expect(warningCalls).toContain("'downloadDir' found directly under 'globalConfig'");
      expect(warningCalls).toContain("'tempDir' found directly under 'globalConfig'");
      expect(warningCalls).toContain("'count' found directly under 'globalConfig'");
      expect(warningCalls).toContain(
        "'downloadDir' found directly under 'domainConfigs[0]. It should be placed under 'domainConfigs[0].download'",
      );
      // Note: Series validation is not implemented in the current version

      console.warn = originalWarn;
    });
  });

  describe('Windows Real-World Scenarios', () => {
    it('should handle typical Windows home directory setup', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Users\\JohnDoe\\Downloads\\TV Shows',
            tempDir: 'C:\\Users\\JohnDoe\\AppData\\Local\\Temp\\wetvlo',
          },
          stateFile: 'C:\\Users\\JohnDoe\\Documents\\wetvlo\\state.json',
          cookieFile: 'C:\\Users\\JohnDoe\\Documents\\wetvlo\\cookies.txt',
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('C:\\Users\\JohnDoe\\Downloads\\TV Shows');
      expect(downloadOptions.tempDir).toBe('C:\\Users\\JohnDoe\\AppData\\Local\\Temp\\wetvlo');
      expect(resolved.stateFile).toBe('C:\\Users\\JohnDoe\\Documents\\wetvlo\\state.json');
      expect(resolved.cookieFile).toBe('C:\\Users\\JohnDoe\\Documents\\wetvlo\\cookies.txt');
    });

    it('should handle network drive scenarios', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'Z:\\Media\\Downloads',
            tempDir: 'Z:\\Temp\\wetvlo',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('Z:\\Media\\Downloads');
      expect(downloadOptions.tempDir).toBe('Z:\\Temp\\wetvlo');
    });

    it('should handle portable installation scenario', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: '.\\downloads',
            tempDir: '.\\temp',
          },
          stateFile: '.\\wetvlo-state.json',
          cookieFile: '.\\cookies.txt',
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('.\\downloads');
      expect(downloadOptions.tempDir).toBe('.\\temp');
      expect(resolved.stateFile).toBe('.\\wetvlo-state.json');
      expect(resolved.cookieFile).toBe('.\\cookies.txt');
    });
  });

  describe('Windows Configuration File Loading', () => {
    it('should load complex Windows YAML configuration', async () => {
      const complexWindowsConfig = {
        series: [
          {
            name: 'Китайский Сериал 1',
            url: 'https://wetv.vip/series1',
            startTime: '20:00',
            download: {
              downloadDir: 'D:\\Сериалы\\Китайские\\Сериал 1',
              tempDir: 'D:\\Temp\\wetvlo\\serial1',
              maxRetries: 5,
            },
          },
          {
            name: 'Китайский Сериал 2',
            url: 'https://iqiyi.com/series2',
            startTime: '21:00',
            // Will use domain config
          },
        ],
        domainConfigs: [
          {
            domain: 'wetv.vip',
            download: {
              downloadDir: 'D:\\Сериалы\\WeTV',
              tempDir: 'D:\\Temp\\wetvlo',
              downloadDelay: 15,
            },
          },
          {
            domain: 'iqiyi.com',
            download: {
              downloadDir: 'D:\\Сериалы\\iQIYI',
              tempDir: 'D:\\Temp\\wetvlo\\iqiyi',
              downloadDelay: 20,
            },
          },
        ],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\Сериалы',
            tempDir: 'C:\\Temp\\wetvlo',
            maxRetries: 3,
            downloadDelay: 10,
            minDuration: 300,
          },
          check: {
            count: 5,
            checkInterval: 600,
            downloadTypes: ['available', 'vip'],
          },
          stateFile: 'C:\\Users\\User\\Documents\\wetvlo\\state.json',
          cookieFile: 'C:\\Users\\User\\Documents\\wetvlo\\cookies.txt',
          browser: 'chrome',
          subLangs: ['ru', 'zh', 'en'],
        },
      };

      const configPath = `complex-windows-config-${Date.now()}.yaml`;
      const yamlContent = yaml.dump(complexWindowsConfig);
      fs.writeFileSync(configPath, yamlContent, 'utf-8');

      try {
        const { loadConfig } = await import('./config-loader.js');
        const config = await loadConfig(configPath);

        expect(config.series).toHaveLength(2);
        expect(config.domainConfigs).toHaveLength(2);
        expect(config.globalConfig?.download?.downloadDir).toBe('C:\\Downloads\\Сериалы');
        expect(config.globalConfig?.subLangs).toEqual(['ru', 'zh', 'en']);

        // Test registry creation
        const registry = new ConfigRegistry(config);

        const resolved1 = registry.resolve('https://wetv.vip/series1', 'series');
        const downloadOptions1 = extractDownloadOptions(resolved1);
        expect(downloadOptions1.downloadDir).toBe('D:\\Сериалы\\Китайские\\Сериал 1');

        const resolved2 = registry.resolve('https://iqiyi.com/series2', 'series');
        const downloadOptions2 = extractDownloadOptions(resolved2);
        expect(downloadOptions2.downloadDir).toBe('D:\\Сериалы\\iQIYI');
      } finally {
        if (fs.existsSync(configPath)) {
          fs.unlinkSync(configPath);
        }
      }
    });
  });

  describe('Windows Performance and Edge Cases', () => {
    it('should handle extremely long Windows paths', () => {
      const longPathSegment = 'VeryLongDirectoryName'.repeat(10);
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: `C:\\${longPathSegment}\\Downloads`,
            tempDir: `C:\\${longPathSegment}\\Temp`,
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toContain('VeryLongDirectoryName');
      expect(downloadOptions.tempDir).toContain('VeryLongDirectoryName');
    });

    it('should handle Windows path normalization', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\..\\Media\\Downloads',
            tempDir: '.\\temp\\.\\downloads',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      // Should preserve the original path format
      expect(downloadOptions.downloadDir).toBe('C:\\Downloads\\..\\Media\\Downloads');
      expect(downloadOptions.tempDir).toBe('.\\temp\\.\\downloads');
    });
  });
});
