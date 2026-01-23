/**
 * Episode data in series-grouped state
 */
export type SeriesEpisode = {
  /** Episode URL */
  url: string;
  /** Downloaded filename */
  filename: string;
  /** Download timestamp */
  downloadedAt: string;
  /** File size in bytes (for verification) */
  size: number;
};

/**
 * Series data in state
 */
export type SeriesData = {
  /** Series name */
  name: string;
  /** Episodes keyed by padded number (e.g., "01", "02") */
  episodes: Record<string, SeriesEpisode>;
};

/**
 * State file structure (v2.0.0)
 */
export type State = {
  /** State format version */
  version: string;
  /** Series keyed by URL */
  series: Record<string, SeriesData>;
  /** Last update timestamp */
  lastUpdated: string;
};

/**
 * Create a new empty state (v2.0.0)
 */
export function createEmptyState(): State {
  return {
    version: '2.0.0',
    series: {},
    lastUpdated: new Date().toISOString(),
  };
}
