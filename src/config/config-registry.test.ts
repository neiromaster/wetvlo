import { describe, expect, it } from 'bun:test';
import { ConfigRegistry } from './config-registry.js';
import type { Config, DomainConfig, GlobalConfig, SeriesConfig } from './config-schema.js';

describe('ConfigRegistry', () => {
  const mockDomainConfig: DomainConfig = {
    domain: 'example.com',
    stateFile: './state.json',
    check: { count: 10 },
    download: { downloadDelay: 20 },
  };

  const mockGlobalConfig: GlobalConfig = {
    stateFile: './state.json',
    check: { checkInterval: 300 },
    download: { maxRetries: 5 },
  };

  const mockSeries: SeriesConfig = {
    name: 'Test Series',
    url: 'https://example.com/play/123',
    startTime: '20:00',
    check: { count: 5 },
    download: { downloadDelay: 2 },
  };

  const mockConfig: Config = {
    series: [mockSeries],
    globalConfig: mockGlobalConfig,
    domainConfigs: [mockDomainConfig],
  };

  it('should return defaults when no configs provided', () => {
    const minimalSeries: SeriesConfig = {
      name: 'Minimal',
      url: 'https://example.com/play/456',
      startTime: '20:00',
    };

    const config: Config = {
      series: [minimalSeries],
    };

    const registry = new ConfigRegistry(config);
    const result = registry.resolve(minimalSeries.url, 'series');

    // Check defaults - fields are required in resolved types
    expect(result.check.count).toBe(3); // Default
    expect(result.check.checkInterval).toBe(600); // Default
    expect(result.download.downloadDir).toBe('./downloads'); // Default
    expect(result.download.maxRetries).toBe(3); // Default
  });

  it('should merge hierarchy correctly: Series > Domain > Global > Default', () => {
    const registry = new ConfigRegistry(mockConfig);
    const result = registry.resolve(mockSeries.url, 'series');

    // Series overrides domain (count: 5 vs 10)
    expect(result.check.count).toBe(5);

    // Series overrides domain (downloadDelay: 2 vs 20)
    expect(result.download.downloadDelay).toBe(2);

    // Domain overrides global (checkInterval: 300 vs default 600)
    expect(result.check.checkInterval).toBe(300); // From global

    // Global overrides default
    expect(result.download.maxRetries).toBe(5); // From global

    // Default values
    expect(result.download.jitterPercentage).toBe(10); // From defaults
  });

  it('should resolve domain config correctly', () => {
    const registry = new ConfigRegistry(mockConfig);
    const result = registry.resolve('https://example.com/test', 'domain');

    expect(result.check.count).toBe(10); // From domain
    expect(result.check.checkInterval).toBe(300); // From global
    expect(result.download.maxRetries).toBe(5); // From global
  });

  it('should resolve global config correctly', () => {
    const registry = new ConfigRegistry(mockConfig);
    const result = registry.resolve('any-url', 'global');

    expect(result.check.checkInterval).toBe(300); // From global
    expect(result.download.maxRetries).toBe(5); // From global
  });

  it('should list all series', () => {
    const registry = new ConfigRegistry(mockConfig);
    const series = registry.listSeries();

    expect(series).toHaveLength(1);
    const firstSeries = series[0];
    expect(firstSeries).toBeDefined();
    if (!firstSeries) {
      throw new Error('Expected series to be defined');
    }
    expect(firstSeries).toMatchObject({
      name: mockSeries.name,
      url: mockSeries.url,
      startTime: mockSeries.startTime,
    });
    // Check that resolved config has required fields
    expect(firstSeries.check).toBeDefined();
    expect(firstSeries.download).toBeDefined();
  });

  it('should list all series URLs', () => {
    const registry = new ConfigRegistry(mockConfig);
    const urls = registry.listSeriesUrls();

    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(mockSeries.url);
  });

  it('should list all domains', () => {
    const registry = new ConfigRegistry(mockConfig);
    const domains = registry.listDomains();

    expect(domains).toHaveLength(1);
    expect(domains[0]).toBe('example.com');
  });

  it('should throw error for unknown URL', () => {
    const registry = new ConfigRegistry(mockConfig);

    expect(() => {
      registry.resolve('https://unknown.com/test', 'series');
    }).toThrow('No configuration found for URL');
  });

  it('should fall back to global when domain config not found', () => {
    const registry = new ConfigRegistry(mockConfig);
    const result = registry.resolve('https://unknown.com/test', 'domain');

    // Should fall back to global config
    expect(result.check.checkInterval).toBe(300);
    expect(result.download.maxRetries).toBe(5);
  });
});
