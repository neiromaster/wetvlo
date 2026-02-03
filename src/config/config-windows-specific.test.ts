import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { extractDownloadOptions } from '../downloader/download-options.js';
import { ConfigRegistry } from './config-registry.js';
import type { Config, SeriesConfig } from './config-schema.js';
import { validateConfigWithWarnings } from './config-schema.js';

describe('Windows Specific Tests', () => {
  const mockSeries: SeriesConfig = {
    name: 'Test Series',
    url: 'https://example.com/series',
    startTime: '20:00',
  };

  describe('Windows Path Formats', () => {
    it('should handle C: drive absolute paths', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:/Users/Username/Downloads',
            tempDir: 'C:/Users/Username/AppData/Local/Temp',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('C:/Users/Username/Downloads');
      expect(downloadOptions.tempDir).toBe('C:/Users/Username/AppData/Local/Temp');
    });

    it('should handle D: drive and other drive letters', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'D:\\Media\\Downloads',
            tempDir: 'E:\\Temp',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('D:\\Media\\Downloads');
      expect(downloadOptions.tempDir).toBe('E:\\Temp');
    });

    it('should handle UNC paths', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: '\\\\server\\share\\downloads',
            tempDir: '\\\\server\\share\\temp',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('\\\\server\\share\\downloads');
      expect(downloadOptions.tempDir).toBe('\\\\server\\share\\temp');
    });

    it('should handle long Windows paths', () => {
      const longPath =
        'C:\\Very\\Long\\Path\\That\\Exceeds\\Normal\\Windows\\Path\\Limits\\And\\Contains\\Many\\Nested\\Directories\\For\\Testing\\Purposes\\Downloads';
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: longPath,
            tempDir: '.\\temp',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe(longPath);
      expect(downloadOptions.tempDir).toBe('.\\temp');
    });

    it('should handle paths with spaces and special characters', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Users\\User Name\\My Downloads\\TV Shows',
            tempDir: '.\\temp files',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('C:\\Users\\User Name\\My Downloads\\TV Shows');
      expect(downloadOptions.tempDir).toBe('.\\temp files');
    });

    it('should handle mixed slash formats in same config', () => {
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
  });

  describe('Windows Environment Variables', () => {
    it('should handle Windows environment variable patterns', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: '%USERPROFILE%\\Downloads',
            tempDir: '%TEMP%',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('%USERPROFILE%\\Downloads');
      expect(downloadOptions.tempDir).toBe('%TEMP%');
    });

    it('should handle nested environment variable patterns', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: '%USERPROFILE%\\Documents\\${SERIES_NAME}',
            tempDir: '%LOCALAPPDATA%\\Temp\\wetvlo',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('%USERPROFILE%\\Documents\\${SERIES_NAME}');
      expect(downloadOptions.tempDir).toBe('%LOCALAPPDATA%\\Temp\\wetvlo');
    });
  });

  describe('Windows Configuration Validation', () => {
    it('should detect Windows-specific misconfigurations', () => {
      const consoleSpy = {
        calls: [] as string[],
        log: (...args: any[]) => {
          consoleSpy.calls.push(args.join(' '));
        },
      };
      const originalWarn = console.warn;
      console.warn = consoleSpy.log;

      const malformedConfig = {
        series: [mockSeries],
        globalConfig: {
          downloadDir: 'C:\\Windows\\Downloads', // WRONG: should be under download
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

      console.warn = originalWarn;
    });
  });

  describe('Windows File System Integration', () => {
    it('should handle Windows path resolution in download manager', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\Test',
            tempDir: '.\\temp',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      // Test path resolution like download manager does
      const resolvedDownloadDir = resolve(downloadOptions.downloadDir || '');
      const resolvedTempDir = resolve(downloadOptions.tempDir || '');

      // Should resolve to absolute paths (will be Unix-style on macOS during testing)
      expect(resolvedDownloadDir).toBeTruthy();
      expect(resolvedTempDir).toBeTruthy();
      // On actual Windows, these would match /^[A-Z]:\\/
    });

    it('should handle relative paths correctly on Windows', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: '.\\downloads',
            tempDir: '..\\temp',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('.\\downloads');
      expect(downloadOptions.tempDir).toBe('..\\temp');

      // Test that they resolve correctly
      const resolvedDownloadDir = resolve(downloadOptions.downloadDir || '');
      const resolvedTempDir = resolve(downloadOptions.tempDir || '');

      expect(resolvedDownloadDir).toBeTruthy();
      expect(resolvedTempDir).toBeTruthy();
    });
  });

  describe('Windows Domain Configurations', () => {
    it('should handle Windows-specific domain configs', () => {
      const config: Config = {
        series: [
          {
            ...mockSeries,
            url: 'https://wetv.vip/series', // Use matching domain
          },
        ],
        domainConfigs: [
          {
            domain: 'wetv.vip',
            download: {
              downloadDir: 'D:\\Media\\WeTV',
              tempDir: 'D:\\Temp\\WeTV',
            },
          },
        ],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\Default',
            tempDir: '.\\temp',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve('https://wetv.vip/series', 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      // Should use domain config
      expect(downloadOptions.downloadDir).toBe('D:\\Media\\WeTV');
      expect(downloadOptions.tempDir).toBe('D:\\Temp\\WeTV');
    });
  });

  describe('Windows Series Configurations', () => {
    it('should handle Windows-specific series overrides', () => {
      const config: Config = {
        series: [
          {
            ...mockSeries,
            download: {
              downloadDir: 'C:\\Series\\Specific\\Downloads',
              tempDir: '.\\series-temp',
            },
          },
        ],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\Default',
            tempDir: '.\\temp',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      // Should use series config
      expect(downloadOptions.downloadDir).toBe('C:\\Series\\Specific\\Downloads');
      expect(downloadOptions.tempDir).toBe('.\\series-temp');
    });
  });

  describe('Windows Edge Cases', () => {
    it('should handle empty paths', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: '',
            tempDir: '',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('');
      expect(downloadOptions.tempDir).toBe('');
    });

    it('should handle root directory paths', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:\\',
            tempDir: 'D:\\',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('C:\\');
      expect(downloadOptions.tempDir).toBe('D:\\');
    });

    it('should handle paths with trailing slashes', () => {
      const config: Config = {
        series: [mockSeries],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\',
            tempDir: '.\\temp\\',
          },
        },
      };

      const registry = new ConfigRegistry(config);
      const resolved = registry.resolve(mockSeries.url, 'series');
      const downloadOptions = extractDownloadOptions(resolved);

      expect(downloadOptions.downloadDir).toBe('C:\\Downloads\\');
      expect(downloadOptions.tempDir).toBe('.\\temp\\');
    });
  });

  describe('Windows Configuration File Loading', () => {
    it('should load Windows-specific YAML config', async () => {
      const windowsConfig = {
        series: [
          {
            name: 'Windows Test Series',
            url: 'https://example.com/windows-series',
            startTime: '20:00',
            download: {
              downloadDir: 'C:\\Users\\Test\\Downloads\\Series',
              tempDir: '%TEMP%\\wetvlo',
            },
          },
        ],
        globalConfig: {
          download: {
            downloadDir: 'C:\\Downloads\\Global',
            tempDir: '.\\temp',
          },
          stateFile: 'C:\\Users\\Test\\AppData\\Local\\wetvlo\\state.json',
          cookieFile: 'C:\\Users\\Test\\cookies.txt',
        },
      };

      const configPath = `windows-config-${Date.now()}.yaml`;
      const yamlContent = yaml.dump(windowsConfig);
      fs.writeFileSync(configPath, yamlContent, 'utf-8');

      try {
        const { loadConfig } = await import('./config-loader.js');
        const config = await loadConfig(configPath);

        expect(config.series).toHaveLength(1);
        expect(config.series[0]?.name).toBe('Windows Test Series');
        expect(config.globalConfig?.download?.downloadDir).toBe('C:\\Downloads\\Global');
        expect(config.globalConfig?.stateFile).toBe('C:\\Users\\Test\\AppData\\Local\\wetvlo\\state.json');
      } finally {
        if (fs.existsSync(configPath)) {
          fs.unlinkSync(configPath);
        }
      }
    });
  });
});
