import { describe, expect, it } from 'bun:test';
import { DEFAULT_CHECK_SETTINGS, DEFAULT_DOWNLOAD_SETTINGS } from './config-defaults.js';
import { ConfigResolver } from './config-resolver.js';
import type { DomainConfig, GlobalConfigs, SeriesConfig } from './config-schema.js';

describe('ConfigResolver', () => {
  const mockDomainConfig: DomainConfig = {
    domain: 'example.com',
    check: { count: 10 },
    download: { downloadDelay: 20 },
  };

  const mockGlobalConfig: GlobalConfigs = {
    check: { checkInterval: 300 },
    download: { maxRetries: 5 },
  };

  const mockSeries: SeriesConfig = {
    name: 'Test Series',
    url: 'https://example.com/play/123',
    startTime: '20:00',
    check: { count: 5 }, // Overrides domain
    download: { downloadDelay: 2 }, // Overrides domain
  };

  it('should return defaults when no configs provided', () => {
    const resolver = new ConfigResolver();
    const result = resolver.resolve({ ...mockSeries, check: undefined, download: undefined });

    expect(result.check).toEqual(DEFAULT_CHECK_SETTINGS);
    expect(result.download).toEqual(DEFAULT_DOWNLOAD_SETTINGS);
  });

  it('should merge hierarchy correctly: Series > Domain > Global > Default', () => {
    const resolver = new ConfigResolver([mockDomainConfig], mockGlobalConfig);
    const result = resolver.resolve(mockSeries);

    // Series overrides domain (count: 5 vs 10)
    expect(result.check.count).toBe(5);
    // Domain overrides global (downloadDelay: 2 vs 20, but series has 2)
    // Wait, series has 2.
    expect(result.download.downloadDelay).toBe(2);

    // Domain should override global/default if series is undefined
    const seriesWithoutDelay = { ...mockSeries, download: undefined };
    const result2 = resolver.resolve(seriesWithoutDelay);
    expect(result2.download.downloadDelay).toBe(20); // From domain

    // Global should override default if domain/series undefined
    expect(result.check.checkInterval).toBe(300); // From global
    expect(result.download.maxRetries).toBe(5); // From global

    // Default if nothing else
    expect(result.download.jitterPercentage).toBe(DEFAULT_DOWNLOAD_SETTINGS.jitterPercentage);
  });

  it('should resolve domain config correctly', () => {
    const resolver = new ConfigResolver([mockDomainConfig], mockGlobalConfig);
    const result = resolver.resolveDomain('example.com');

    expect(result.check.count).toBe(10); // From domain
    expect(result.check.checkInterval).toBe(300); // From global
    expect(result.download.maxRetries).toBe(5); // From global
  });
});
