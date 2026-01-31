/**
 * Global application context
 *
 * Provides centralized access to shared services (config, notifier).
 * Eliminates the need to pass these dependencies through multiple layers.
 *
 * Usage:
 *   1. Initialize early in app startup: AppContext.initialize(...)
 *   2. Access anywhere: import { AppContext } from './app-context'
 */

import { ConfigResolver } from './config/config-resolver.js';
import type { Notifier } from './notifications/notifier.js';
import type { DomainConfig, GlobalConfigs } from './types/config.types.js';

/**
 * Global application context singleton
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Intentional singleton pattern for global app context
export class AppContext {
  private static configResolver?: ConfigResolver;
  private static notifier?: Notifier;
  private static domainConfigs?: DomainConfig[];
  private static globalConfigs?: GlobalConfigs;

  /**
   * Initialize the application context
   *
   * Called once during app startup to set up shared services.
   *
   * @param globalConfigs - Global configuration defaults
   * @param domainConfigs - Domain-specific configurations
   * @param notifier - Notifier instance
   */
  static initialize(globalConfigs?: GlobalConfigs, domainConfigs?: DomainConfig[], notifier?: Notifier): void {
    AppContext.globalConfigs = globalConfigs;
    AppContext.domainConfigs = domainConfigs;
    AppContext.configResolver = new ConfigResolver(domainConfigs, globalConfigs);

    if (notifier) {
      AppContext.notifier = notifier;
    }
  }

  /**
   * Get the config resolver instance
   *
   * @throws Error if context not initialized
   */
  static getConfig(): ConfigResolver {
    if (!AppContext.configResolver) {
      throw new Error('AppContext not initialized. Call AppContext.initialize() first.');
    }
    return AppContext.configResolver;
  }

  /**
   * Get the notifier instance
   *
   * @throws Error if context not initialized
   */
  static getNotifier(): Notifier {
    if (!AppContext.notifier) {
      throw new Error('AppContext not initialized. Call AppContext.initialize() first.');
    }
    return AppContext.notifier;
  }

  /**
   * Reload configuration
   *
   * Creates a new ConfigResolver with updated configuration.
   * Useful for runtime config reloading.
   *
   * @param globalConfigs - New global configuration defaults
   * @param domainConfigs - New domain-specific configurations
   */
  static reloadConfig(globalConfigs?: GlobalConfigs, domainConfigs?: DomainConfig[]): void {
    AppContext.globalConfigs = globalConfigs;
    AppContext.domainConfigs = domainConfigs;
    AppContext.configResolver = new ConfigResolver(domainConfigs, globalConfigs);
  }

  /**
   * Update the notifier instance
   *
   * Useful for hot-swapping notifiers (e.g., adding Telegram).
   *
   * @param notifier - New notifier instance
   */
  static setNotifier(notifier: Notifier): void {
    AppContext.notifier = notifier;
  }

  /**
   * Get current global configs (for inspection)
   */
  static getGlobalConfigs(): GlobalConfigs | undefined {
    return AppContext.globalConfigs;
  }

  /**
   * Get current domain configs (for inspection)
   */
  static getDomainConfigs(): DomainConfig[] | undefined {
    return AppContext.domainConfigs;
  }

  /**
   * Check if context is initialized
   */
  static isInitialized(): boolean {
    return AppContext.configResolver !== undefined;
  }

  /**
   * Reset the context (useful for testing)
   */
  static reset(): void {
    AppContext.configResolver = undefined;
    AppContext.notifier = undefined;
    AppContext.domainConfigs = undefined;
    AppContext.globalConfigs = undefined;
  }
}
