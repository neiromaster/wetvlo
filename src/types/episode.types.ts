/**
 * Episode availability type
 */
export enum EpisodeType {
  /** VIP episode - requires premium */
  VIP = 'vip',
  /** Preview/trailer only */
  PREVIEW = 'preview',
  /** Available to watch */
  AVAILABLE = 'available',
  /** Locked/not yet released */
  LOCKED = 'locked',
  /** Teaser/short preview */
  TEASER = 'teaser',
  /** Express episode (early release) */
  EXPRESS = 'express',
}

/**
 * Episode type as a union type for convenience
 */
export type EpisodeTypeUnion = 'vip' | 'preview' | 'available' | 'locked' | 'teaser' | 'express';

/**
 * Episode information extracted from series page
 */
export type Episode = {
  /** Episode number */
  number: number;
  /** URL of the episode page */
  url: string;
  /** Episode availability type */
  type: EpisodeType;
  /** Optional episode title */
  title?: string;
  /** When this episode data was extracted */
  extractedAt: Date;
};

/**
 * Downloaded episode record in state
 */
export type DownloadedEpisode = {
  /** Episode number */
  number: number;
  /** Episode URL */
  url: string;
  /** When it was downloaded */
  downloadedAt: string;
  /** URL of the series it belongs to */
  seriesUrl: string;
  /** Series name */
  seriesName: string;
  /** Filename of the downloaded video */
  filename: string;
};
