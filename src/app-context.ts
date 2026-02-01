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

import type { ConfigRegistry } from './config/config-registry.js';
import type { Notifier } from './notifications/notifier.js';
import { StateManager } from './state/state-manager.js';

/**
 * Global application context singleton
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Intentional singleton pattern for global app context
export class AppContext {
  private static configRegistry?: ConfigRegistry;
  private static notifier?: Notifier;
  private static stateManager?: StateManager;

  /**
   * Initialize the application context with pre-created services
   *
   * Called once during app startup to set up shared services.
   *
   * @param configRegistry - Config registry instance
   * @param notifier - Notifier instance
   * @param stateManager - State manager instance (optional, created from notifier if not provided)
   */
  static initialize(configRegistry: ConfigRegistry, notifier: Notifier, stateManager?: StateManager): void {
    AppContext.configRegistry = configRegistry;
    AppContext.notifier = notifier;
    AppContext.stateManager = stateManager || (notifier ? new StateManager(notifier) : undefined);
  }

  /**
   * Get the config registry instance
   *
   * @throws Error if context not initialized
   */
  static getConfig(): ConfigRegistry {
    if (!AppContext.configRegistry) {
      throw new Error('AppContext not initialized. Call AppContext.initialize() first.');
    }
    return AppContext.configRegistry;
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
   * Get the state manager instance
   *
   * @throws Error if context not initialized
   */
  static getStateManager(): StateManager {
    if (!AppContext.stateManager) {
      throw new Error('AppContext not initialized. Call AppContext.initialize() first.');
    }
    return AppContext.stateManager;
  }

  /**
   * Reload configuration
   *
   * Updates the ConfigRegistry with new configuration.
   * Useful for runtime config reloading.
   *
   * @param configRegistry - New config registry instance
   */
  static reloadConfig(configRegistry: ConfigRegistry): void {
    AppContext.configRegistry = configRegistry;
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
   * Check if context is initialized
   */
  static isInitialized(): boolean {
    return AppContext.configRegistry !== undefined;
  }

  /**
   * Reset the context (useful for testing)
   */
  static reset(): void {
    AppContext.configRegistry = undefined;
    AppContext.notifier = undefined;
    AppContext.stateManager = undefined;
  }
}
