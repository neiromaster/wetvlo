import { describe, expect, it } from 'bun:test';
import { ConfigRegistry } from './config-registry.js';
import type { Config, SeriesConfig } from './config-schema.js';

describe('ConfigRegistry - Windows Path Handling', () => {
  const mockSeries: SeriesConfig = {
    name: 'Test Series',
    url: 'https://example.com/series',
    startTime: '20:00',
  };

  it('should handle Windows absolute paths correctly', () => {
    const config: Config = {
      series: [mockSeries],
      globalConfig: {
        download: {
          downloadDir: 'C:/Downloads/MySeries',
          tempDir: './temp',
        },
      },
    };

    const registry = new ConfigRegistry(config);
    const result = registry.resolve(mockSeries.url, 'series');

    // Should use the Windows absolute path from config
    expect(result.download.downloadDir).toBe('C:/Downloads/MySeries');
    expect(result.download.tempDir).toBe('./temp');
  });

  it('should handle Windows relative paths correctly', () => {
    const config: Config = {
      series: [mockSeries],
      globalConfig: {
        download: {
          downloadDir: './downloads',
          tempDir: './temp',
        },
      },
    };

    const registry = new ConfigRegistry(config);
    const result = registry.resolve(mockSeries.url, 'series');

    // Should use the relative paths from config
    expect(result.download.downloadDir).toBe('./downloads');
    expect(result.download.tempDir).toBe('./temp');
  });

  it('should handle mixed absolute and relative paths', () => {
    const config: Config = {
      series: [mockSeries],
      globalConfig: {
        download: {
          downloadDir: 'D:\\Absolute\\Path\\Downloads',
          tempDir: './relative/temp',
        },
      },
    };

    const registry = new ConfigRegistry(config);
    const result = registry.resolve(mockSeries.url, 'series');

    // Should preserve the exact paths from config
    expect(result.download.downloadDir).toBe('D:\\Absolute\\Path\\Downloads');
    expect(result.download.tempDir).toBe('./relative/temp');
  });

  it('should override defaults with user-defined paths', () => {
    const config: Config = {
      series: [mockSeries],
      globalConfig: {
        download: {
          downloadDir: 'C:/Custom/Downloads',
          tempDir: 'C:/Custom/Temp',
        },
      },
    };

    const registry = new ConfigRegistry(config);
    const result = registry.resolve(mockSeries.url, 'series');

    // Should override defaults ('./downloads' and './downloads')
    expect(result.download.downloadDir).toBe('C:/Custom/Downloads');
    expect(result.download.tempDir).toBe('C:/Custom/Temp');
  });

  it('should handle partial download config overrides', () => {
    const config: Config = {
      series: [mockSeries],
      globalConfig: {
        download: {
          downloadDir: 'C:/Only/DownloadDir/Specified',
          // tempDir should use default
        },
      },
    };

    const registry = new ConfigRegistry(config);
    const result = registry.resolve(mockSeries.url, 'series');

    // downloadDir should be overridden, tempDir should use default
    expect(result.download.downloadDir).toBe('C:/Only/DownloadDir/Specified');
    expect(result.download.tempDir).toBe('./downloads'); // Default
  });
});
