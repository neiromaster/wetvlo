import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StateError } from '../errors/custom-errors';
import type { State } from '../types/state.types';
import { createEmptyState } from '../types/state.types';

/**
 * State manager class for tracking downloaded episodes (v3.0.0 - simplified)
 */
export class StateManager {
  private state: State;
  private statePath: string;
  private dirty: boolean = false;

  constructor(statePath: string) {
    this.statePath = join(process.cwd(), statePath);
    this.state = createEmptyState();
  }

  /**
   * Load state from file
   */
  async load(): Promise<void> {
    if (!existsSync(this.statePath)) {
      this.state = createEmptyState();
      this.dirty = true;
      await this.save();
      return;
    }

    try {
      const content = await readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(content) as State;
      this.dirty = false;
    } catch (error) {
      throw new StateError(`Failed to load state file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save state to file
   */
  async save(): Promise<void> {
    if (!this.dirty) return;

    try {
      // Sort series keys
      const sortedSeries: Record<string, string[]> = {};
      Object.keys(this.state.series)
        .sort()
        .forEach((key) => {
          // Sort episode numbers
          const episodes = this.state.series[key];
          if (episodes) {
            sortedSeries[key] = [...episodes].sort();
          }
        });

      this.state.series = sortedSeries;

      const content = JSON.stringify(this.state, null, 2);
      await writeFile(this.statePath, content, 'utf-8');
      this.dirty = false;
    } catch (error) {
      throw new StateError(`Failed to save state file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if an episode has been downloaded
   */
  isDownloaded(seriesName: string, episodeNumber: number): boolean {
    const episodes = this.state.series[seriesName];
    if (!episodes) return false;

    const paddedNumber = String(episodeNumber).padStart(2, '0');
    return episodes.includes(paddedNumber);
  }

  /**
   * Add a downloaded episode to state
   */
  addDownloadedEpisode(seriesName: string, episodeNumber: number): void {
    if (!this.state.series[seriesName]) {
      this.state.series[seriesName] = [];
    }

    const paddedNumber = String(episodeNumber).padStart(2, '0');

    if (!this.state.series[seriesName].includes(paddedNumber)) {
      this.state.series[seriesName].push(paddedNumber);
      this.dirty = true;
    }
  }

  /**
   * Get all episodes for a series
   */
  getSeriesEpisodes(seriesName: string): string[] {
    return this.state.series[seriesName] ?? [];
  }

  /**
   * Delete a series from state (for finished shows)
   */
  deleteSeries(seriesName: string): void {
    if (this.state.series[seriesName]) {
      delete this.state.series[seriesName];
      this.dirty = true;
    }
  }

  /**
   * Get all series names
   */
  getAllSeriesNames(): string[] {
    return Object.keys(this.state.series);
  }

  /**
   * Get total downloaded episodes count
   */
  getDownloadedCount(): number {
    let count = 0;
    for (const episodes of Object.values(this.state.series)) {
      count += episodes.length;
    }
    return count;
  }

  /**
   * Clear all downloaded episodes (for testing/debugging)
   */
  clearAll(): void {
    this.state = createEmptyState();
    this.dirty = true;
  }

  /**
   * Force save regardless of dirty flag
   */
  async forceSave(): Promise<void> {
    this.dirty = true;
    await this.save();
  }
}
