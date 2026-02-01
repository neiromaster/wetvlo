/**
 * ConfigRegistry - Centralized configuration registry with pre-merged configs
 *
 * Merges configuration at construction time:
 * defaults → global → domain → series
 *
 * Simplified API:
 * - registry.resolve(url) - Get resolved config for a series URL
 * - registry.resolve(url, "domain") - Get domain-level config
 * - registry.resolve(url, "global") - Get global-level config
 */

import { deepMerge } from '../utils/deep-merge.js';
import { extractDomain } from '../utils/url-utils.js';
import { getDefaults } from './config-defaults.js';
import type {
  Config,
  DomainConfigResolved,
  GlobalConfigResolved,
  Level,
  ResolvedConfig,
  SeriesConfigResolved,
} from './config-schema.js';

type SeriesKey = `series:${string}`;

type DomainKye = `domain:${string}`;

type GlobalKey = 'global';

type ValidKey = GlobalKey | DomainKye | SeriesKey;

/**
 * Configuration registry with pre-merged configs
 */
export class ConfigRegistry {
  private readonly map = new Map<ValidKey, GlobalConfigResolved | DomainConfigResolved | SeriesConfigResolved>();
  private readonly seriesByUrl = new Map<string, SeriesConfigResolved>();

  /**
   * Create a new ConfigRegistry
   *
   * @param root - Root configuration object
   */
  constructor(root: Config) {
    // Merge at construction time: defaults → global → domain → series
    const defaults = getDefaults();

    const globalMerged = deepMerge(defaults, root.globalConfig);
    this.setConfig('global', globalMerged);

    // Domain configs
    for (const dc of root.domainConfigs || []) {
      const domainMerged = deepMerge(globalMerged, dc);
      this.setConfig(`domain:${dc.domain}`, domainMerged);
    }

    // Series configs
    for (const sc of root.series) {
      const hostname = extractDomain(sc.url);
      let domainMerged = this.getConfig(`domain:${hostname}`);
      if (!domainMerged) {
        const globalConfig = this.getConfig('global');
        domainMerged = deepMerge(globalConfig, { domain: hostname });
      }
      const seriesMerged = deepMerge(domainMerged, sc);
      this.setConfig(`series:${sc.url}`, seriesMerged);
      this.seriesByUrl.set(sc.url, seriesMerged);
    }
  }

  getConfig(key: 'global'): GlobalConfigResolved;
  getConfig(key: `domain:${string}`): DomainConfigResolved | undefined;
  getConfig(key: `series:${string}`): SeriesConfigResolved;
  getConfig(key: ValidKey): GlobalConfigResolved | DomainConfigResolved | SeriesConfigResolved | undefined {
    return this.map.get(key) as GlobalConfigResolved | DomainConfigResolved | SeriesConfigResolved | undefined;
  }

  setConfig(key: 'global', config: GlobalConfigResolved): void;
  setConfig(key: `domain:${string}`, config: DomainConfigResolved): void;
  setConfig(key: `series:${string}`, config: SeriesConfigResolved): void;
  setConfig(key: ValidKey, config: GlobalConfigResolved | DomainConfigResolved | SeriesConfigResolved): void {
    this.map.set(key, config);
  }

  /**
   * Resolve configuration for a URL
   *
   * @param url - Series URL
   * @param level - Resolution level ("full", "domain", or "global")
   * @returns Resolved configuration
   */
  resolve<L extends Level>(url: string, level?: L): ResolvedConfig<L> {
    if (level === 'global') {
      const config = this.getConfig('global');
      if (!config) {
        throw new Error('Global configuration not found');
      }
      return config as ResolvedConfig<L>;
    }

    if (level === 'domain') {
      const domain = extractDomain(url);
      const config = this.getConfig(`domain:${domain}`);
      if (!config) {
        // Fall back to global if domain config not found
        const globalConfig = this.getConfig('global');
        if (!globalConfig) {
          throw new Error('Global configuration not found');
        }
        return Object.assign(globalConfig, { domain }) as ResolvedConfig<L>;
      }
      return config as ResolvedConfig<L>;
    }

    // Default to "full" resolution
    const config = this.getConfig(`series:${url}`);
    if (!config) {
      throw new Error(`No configuration found for URL: ${url}`);
    }

    const resolved = config;
    this.validate(resolved);
    return resolved as ResolvedConfig<L>;
  }

  /**
   * List all series configurations
   *
   * @returns Array of series configurations
   */
  listSeries(): SeriesConfigResolved[] {
    return Array.from(this.seriesByUrl.values());
  }

  /**
   * List all series URLs
   *
   * @returns Array of series URLs
   */
  listSeriesUrls(): string[] {
    return Array.from(this.seriesByUrl.keys());
  }

  /**
   * List all configured domains
   *
   * @returns Array of domain names
   */
  listDomains(): string[] {
    const domains = new Set<string>();
    for (const url of this.seriesByUrl.keys()) {
      domains.add(extractDomain(url));
    }
    return Array.from(domains);
  }

  /**
   * Validate resolved configuration
   */
  private validate(config: SeriesConfigResolved): void {
    if (!config.check) {
      throw new Error('Missing check configuration');
    }
    if (!config.download) {
      throw new Error('Missing download configuration');
    }

    const { check, download } = config;

    if (check.count < 1) {
      throw new Error(`Invalid check count: ${check.count}`);
    }
    if (check.checkInterval < 0) {
      throw new Error(`Invalid check interval: ${check.checkInterval}`);
    }
    if (download.downloadDelay < 0) {
      throw new Error(`Invalid download delay: ${download.downloadDelay}`);
    }
    if (download.maxRetries < 0) {
      throw new Error(`Invalid max retries: ${download.maxRetries}`);
    }
    if (download.initialTimeout < 0) {
      throw new Error(`Invalid initial timeout: ${download.initialTimeout}`);
    }
    if (download.backoffMultiplier < 1) {
      throw new Error(`Invalid backoff multiplier: ${download.backoffMultiplier}`);
    }
    if (download.minDuration < 0) {
      throw new Error(`Invalid min duration: ${download.minDuration}`);
    }
  }
}
