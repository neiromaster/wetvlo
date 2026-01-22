import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { StateError } from '../errors/custom-errors';
import type { DownloadedEpisode } from '../types/episode.types';
import type { State } from '../types/state.types';
import { createEmptyState } from '../types/state.types';

/**
 * State manager class for tracking downloaded episodes
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
      // Create new state file
      this.state = createEmptyState();
      this.dirty = true;
      await this.save();
      return;
    }

    try {
      const file = Bun.file(this.statePath);
      const content = await file.text();
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
    if (!this.dirty) {
      return;
    }

    try {
      this.state.lastUpdated = new Date().toISOString();
      const content = JSON.stringify(this.state, null, 2);
      await Bun.write(this.statePath, content);
      this.dirty = false;
    } catch (error) {
      throw new StateError(`Failed to save state file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if an episode has been downloaded
   */
  isDownloaded(seriesUrl: string, episodeNumber: number): boolean {
    return this.state.downloadedEpisodes.some((ep) => ep.seriesUrl === seriesUrl && ep.number === episodeNumber);
  }

  /**
   * Add a downloaded episode to state
   */
  addDownloadedEpisode(episode: DownloadedEpisode): void {
    // Check if already exists
    const exists = this.isDownloaded(episode.seriesUrl, episode.number);
    if (exists) {
      return;
    }

    this.state.downloadedEpisodes.push(episode);
    this.dirty = true;
  }

  /**
   * Get all downloaded episodes for a series
   */
  getDownloadedEpisodes(seriesUrl: string): DownloadedEpisode[] {
    return this.state.downloadedEpisodes.filter((ep) => ep.seriesUrl === seriesUrl);
  }

  /**
   * Get state object
   */
  getState(): State {
    return { ...this.state };
  }

  /**
   * Get count of downloaded episodes
   */
  getDownloadedCount(): number {
    return this.state.downloadedEpisodes.length;
  }

  /**
   * Clear all downloaded episodes (for testing/debugging)
   */
  clearAll(): void {
    this.state.downloadedEpisodes = [];
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
