import type { CheckSettings, DownloadSettings } from './config-schema.js';

/**
 * Resolved check settings with all fields required
 */
export type ResolvedCheckSettings = Required<CheckSettings>;

/**
 * Resolved download settings with all fields required
 */
export type ResolvedDownloadSettings = Required<DownloadSettings>;

/**
 * Full resolved configuration for a series
 */
export type ResolvedSeriesConfig = {
  check: ResolvedCheckSettings;
  download: ResolvedDownloadSettings;
};
