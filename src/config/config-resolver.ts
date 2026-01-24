import { extractDomain } from '../utils/url-utils.js';
import { DEFAULT_CHECK_SETTINGS, DEFAULT_DOWNLOAD_SETTINGS } from './config-defaults.js';
import type { CheckSettings, DomainConfig, DownloadSettings, GlobalConfigs, SeriesConfig } from './config-schema.js';
import type { ResolvedCheckSettings, ResolvedDownloadSettings, ResolvedSeriesConfig } from './resolved-config.types.js';

/**
 * Centralized configuration resolver
 *
 * Handles the merging hierarchy:
 * 1. Series Config (Highest Priority)
 * 2. Domain Config
 * 3. Global Config
 * 4. Default Config (Lowest Priority)
 */
export class ConfigResolver {
  private domainConfigs: Map<string, DomainConfig>;
  private globalConfigs?: GlobalConfigs;

  /**
   * Create a new ConfigResolver
   *
   * @param domainConfigs - List of domain-specific configurations
   * @param globalConfigs - Global configuration defaults
   */
  constructor(domainConfigs: DomainConfig[] = [], globalConfigs?: GlobalConfigs) {
    this.domainConfigs = new Map(domainConfigs.map((c) => [c.domain, c]));
    this.globalConfigs = globalConfigs;
  }

  /**
   * Resolve configuration for a specific series
   *
   * Merges settings from all levels of the hierarchy to produce a guaranteed
   * full configuration object with no missing values.
   *
   * @param series - The series configuration
   * @returns Fully resolved configuration
   */
  public resolve(series: SeriesConfig): ResolvedSeriesConfig {
    const domain = extractDomain(series.url);
    const domainConfig = this.domainConfigs.get(domain);

    const config = {
      check: this.mergeCheckSettings(series.check, domainConfig?.check),
      download: this.mergeDownloadSettings(series.download, domainConfig?.download),
    };

    this.validate(config);
    return config;
  }

  /**
   * Merge check settings according to hierarchy
   */
  private mergeCheckSettings(series?: CheckSettings, domain?: CheckSettings): ResolvedCheckSettings {
    const global = this.globalConfigs?.check;
    const defaults = DEFAULT_CHECK_SETTINGS;

    return {
      count: series?.count ?? domain?.count ?? global?.count ?? defaults.count,
      checkInterval: series?.checkInterval ?? domain?.checkInterval ?? global?.checkInterval ?? defaults.checkInterval,
      downloadTypes: series?.downloadTypes ?? domain?.downloadTypes ?? global?.downloadTypes ?? defaults.downloadTypes,
    };
  }

  /**
   * Merge download settings according to hierarchy
   */
  private mergeDownloadSettings(series?: DownloadSettings, domain?: DownloadSettings): ResolvedDownloadSettings {
    const global = this.globalConfigs?.download;
    const defaults = DEFAULT_DOWNLOAD_SETTINGS;

    return {
      downloadDir: series?.downloadDir ?? domain?.downloadDir ?? global?.downloadDir ?? defaults.downloadDir,
      downloadDelay: series?.downloadDelay ?? domain?.downloadDelay ?? global?.downloadDelay ?? defaults.downloadDelay,
      maxRetries: series?.maxRetries ?? domain?.maxRetries ?? global?.maxRetries ?? defaults.maxRetries,
      initialTimeout:
        series?.initialTimeout ?? domain?.initialTimeout ?? global?.initialTimeout ?? defaults.initialTimeout,
      backoffMultiplier:
        series?.backoffMultiplier ??
        domain?.backoffMultiplier ??
        global?.backoffMultiplier ??
        defaults.backoffMultiplier,
      jitterPercentage:
        series?.jitterPercentage ?? domain?.jitterPercentage ?? global?.jitterPercentage ?? defaults.jitterPercentage,
      minDuration: series?.minDuration ?? domain?.minDuration ?? global?.minDuration ?? defaults.minDuration,
    };
  }

  /**
   * Get resolved domain configuration (without series context)
   * Useful for retries where series config might not be readily available,
   * though prefer using resolved series config when possible.
   */
  public resolveDomain(domain: string): ResolvedSeriesConfig {
    const domainConfig = this.domainConfigs.get(domain);

    const config = {
      check: this.mergeCheckSettings(undefined, domainConfig?.check),
      download: this.mergeDownloadSettings(undefined, domainConfig?.download),
    };

    this.validate(config);
    return config;
  }

  /**
   * Update global configurations
   *
   * @param globalConfigs - New global configuration defaults
   */
  public setGlobalConfigs(globalConfigs: GlobalConfigs): void {
    this.globalConfigs = globalConfigs;
  }

  /**
   * Validate resolved configuration
   */
  private validate(config: ResolvedSeriesConfig): void {
    if (config.check.count < 1) throw new Error(`Invalid check count: ${config.check.count}`);
    if (config.check.checkInterval < 0) throw new Error(`Invalid check interval: ${config.check.checkInterval}`);
    if (config.download.downloadDelay < 0) throw new Error(`Invalid download delay: ${config.download.downloadDelay}`);
    if (config.download.maxRetries < 0) throw new Error(`Invalid max retries: ${config.download.maxRetries}`);
    if (config.download.initialTimeout < 0)
      throw new Error(`Invalid initial timeout: ${config.download.initialTimeout}`);
    if (config.download.backoffMultiplier < 1)
      throw new Error(`Invalid backoff multiplier: ${config.download.backoffMultiplier}`);
    if (config.download.minDuration < 0) throw new Error(`Invalid min duration: ${config.download.minDuration}`);
  }
}
