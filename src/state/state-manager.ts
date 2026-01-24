import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StateError } from '../errors/custom-errors';
import type { SeriesEpisode, State } from '../types/state.types';
import { createEmptyState } from '../types/state.types';

/**
 * State manager class for tracking downloaded episodes (v2.0.0 - series-grouped)
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
      this.state.lastUpdated = new Date().toISOString();
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
  isDownloaded(seriesUrl: string, episodeNumber: number): boolean {
    const series = this.state.series[seriesUrl];
    if (!series) return false;

    const paddedNumber = String(episodeNumber).padStart(2, '0');
    return !!series.episodes[paddedNumber];
  }

  /**
   * Add a downloaded episode to state
   */
  addDownloadedEpisode(
    seriesUrl: string,
    seriesName: string,
    episode: {
      number: number;
      url: string;
      filename: string;
      size: number;
    },
  ): void {
    // Get or create series entry
    if (!this.state.series[seriesUrl]) {
      this.state.series[seriesUrl] = {
        name: seriesName,
        episodes: {},
      };
    }

    const paddedNumber = String(episode.number).padStart(2, '0');

    // Skip if already exists
    if (this.state.series[seriesUrl].episodes[paddedNumber]) {
      return;
    }

    this.state.series[seriesUrl].episodes[paddedNumber] = {
      url: episode.url,
      filename: episode.filename,
      downloadedAt: new Date().toISOString(),
      size: episode.size,
    };

    this.dirty = true;
  }

  /**
   * Get all episodes for a series
   */
  getSeriesEpisodes(seriesUrl: string): Record<string, SeriesEpisode> {
    const series = this.state.series[seriesUrl];
    return series?.episodes ?? {};
  }

  /**
   * Delete a series from state (for finished shows)
   */
  deleteSeries(seriesUrl: string): void {
    if (this.state.series[seriesUrl]) {
      delete this.state.series[seriesUrl];
      this.dirty = true;
    }
  }

  /**
   * Get all series URLs
   */
  getAllSeriesUrls(): string[] {
    return Object.keys(this.state.series);
  }

  /**
   * Get series name
   */
  getSeriesName(seriesUrl: string): string | null {
    return this.state.series[seriesUrl]?.name ?? null;
  }

  /**
   * Get total downloaded episodes count
   */
  getDownloadedCount(): number {
    let count = 0;
    for (const series of Object.values(this.state.series)) {
      count += Object.keys(series.episodes).length;
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
