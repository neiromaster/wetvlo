import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { AppContext } from '../app-context';
import { NotificationLevel } from '../notifications/notification-level';
import type { State } from '../types/state.types';
import { createEmptyState } from '../types/state.types';

/**
 * Episode number type (zero-padded string, e.g., "01", "02")
 */
export type EpisodeNumber = string;

/**
 * State manager class for tracking downloaded episodes (v3.0.0 - file-based)
 *
 * This implementation does NOT keep state in memory. Every operation reads/writes
 * the file directly, with mutex protection to ensure atomicity.
 *
 * Usage:
 *   const stateManager = AppContext.getStateManager();
 *   const statePath = resolveStatePath(config);
 *   stateManager.isDownloaded(statePath, seriesName, episodeNumber);
 *   await stateManager.addDownloadedEpisode(statePath, seriesName, episodeNumber);
 */
export class StateManager {
  private static locks = new Map<string, Promise<void>>();

  /**
   * Check if an episode has been downloaded
   *
   * @param statePath - Path to state file (relative or absolute)
   * @param seriesName - Series name
   * @param episodeNumber - Episode number
   * @returns Whether the episode is downloaded
   */
  isDownloaded(statePath: string, seriesName: string, episodeNumber: number): boolean {
    try {
      const state = this.loadState(statePath);
      const episodes = state.series[seriesName];
      if (!episodes) return false;

      const paddedNumber = String(episodeNumber).padStart(2, '0');
      return episodes.includes(paddedNumber);
    } catch (error) {
      this.handleError(error, `Failed to check episode status for ${seriesName}`);
      return false;
    }
  }

  /**
   * Add a downloaded episode to state (atomic operation: read → modify → write)
   *
   * @param statePath - Path to state file (relative or absolute)
   * @param seriesName - Series name
   * @param episodeNumber - Episode number
   */
  async addDownloadedEpisode(statePath: string, seriesName: string, episodeNumber: number): Promise<void> {
    return this.withLock(statePath, async () => {
      try {
        const state = this.loadState(statePath);

        if (!state.series[seriesName]) {
          state.series[seriesName] = [];
        }

        const episodeStr = String(episodeNumber).padStart(2, '0');
        if (!state.series[seriesName].includes(episodeStr)) {
          state.series[seriesName].push(episodeStr);
          state.series[seriesName].sort();
        }

        await this.saveState(statePath, state);
      } catch (error) {
        this.handleError(error, `Failed to add episode for ${seriesName}`);
        throw error;
      }
    });
  }

  /**
   * Get all episodes for a series
   *
   * @param statePath - Path to state file (relative or absolute)
   * @param seriesName - Series name
   * @returns Array of episode numbers (as zero-padded strings)
   */
  getSeriesEpisodes(statePath: string, seriesName: string): EpisodeNumber[] {
    try {
      const state = this.loadState(statePath);
      return state.series[seriesName] ?? [];
    } catch (error) {
      this.handleError(error, `Failed to get episodes for ${seriesName}`);
      return [];
    }
  }

  /**
   * Execute a function with mutex lock for a specific state file
   *
   * @param statePath - Path to state file (used as lock key)
   * @param fn - Function to execute while holding the lock
   * @returns Result of the function
   */
  private async withLock<T>(statePath: string, fn: () => Promise<T>): Promise<T> {
    // Wait for previous operation to complete
    let currentLock = StateManager.locks.get(statePath);
    while (currentLock) {
      await currentLock;
      currentLock = StateManager.locks.get(statePath);
    }

    // Create a new lock
    const lockPromise = (async () => {
      try {
        return await fn();
      } finally {
        StateManager.locks.delete(statePath);
      }
    })();

    // @ts-expect-error - T extends void is guaranteed by usage
    StateManager.locks.set(statePath, lockPromise);
    return lockPromise;
  }

  /**
   * Load state from file
   *
   * @param statePath - Path to state file (relative or absolute)
   * @returns State object
   */
  private loadState(statePath: string): State {
    const fullPath = this.resolvePath(statePath);

    if (!existsSync(fullPath)) {
      return createEmptyState();
    }

    try {
      // Use synchronous read for isDownloaded (non-async method)
      const fileContent = readFileSync(fullPath, 'utf-8');
      return JSON.parse(fileContent) as State;
    } catch (error) {
      throw new Error(
        `Failed to load state from ${fullPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Save state to file
   *
   * @param statePath - Path to state file (relative or absolute)
   * @param state - State object to save
   */
  private async saveState(statePath: string, state: State): Promise<void> {
    const fullPath = this.resolvePath(statePath);

    try {
      // Sort series keys and episode numbers
      const sortedSeries: Record<string, string[]> = {};
      Object.keys(state.series)
        .sort()
        .forEach((key) => {
          const episodes = state.series[key];
          if (episodes) {
            sortedSeries[key] = [...episodes].sort();
          }
        });

      state.series = sortedSeries;

      const content = JSON.stringify(state, null, 2);
      await writeFile(fullPath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save state to ${fullPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Resolve state path to absolute path
   *
   * @param statePath - Path to state file (relative or absolute)
   * @returns Absolute path
   */
  private resolvePath(statePath: string): string {
    // If already absolute, return as-is
    if (isAbsolute(statePath)) {
      return statePath;
    }
    // Otherwise, resolve relative to current working directory
    return join(process.cwd(), statePath);
  }

  /**
   * Handle errors through notifier
   *
   * @param error - Error object
   * @param message - Error message prefix
   */
  private handleError(error: unknown, message: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const fullMessage = `${message}: ${errorMessage}`;

    const notifier = AppContext.getNotifier();
    if (notifier) {
      notifier.notify(NotificationLevel.ERROR, fullMessage);
    } else {
      console.error(fullMessage);
    }
  }
}
