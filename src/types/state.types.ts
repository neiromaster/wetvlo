/**
 * State file structure (v3.0.0)
 */
export type State = {
  /** State format version */
  version: string;
  /** Series keyed by Series Name, values are sorted lists of episode numbers (e.g., "01") */
  series: Record<string, string[]>;
};

/**
 * Create a new empty state (v3.0.0)
 */
export function createEmptyState(): State {
  return {
    version: '3.0.0',
    series: {},
  };
}
