import type { DownloadedEpisode } from './episode.types';

/**
 * State file structure
 */
export type State = {
  /** State file version */
  version: string;
  /** List of downloaded episodes */
  downloadedEpisodes: DownloadedEpisode[];
  /** Last update timestamp */
  lastUpdated: string;
};

/**
 * Create a new empty state
 */
export function createEmptyState(): State {
  return {
    version: '1.0.0',
    downloadedEpisodes: [],
    lastUpdated: new Date().toISOString(),
  };
}
