import { DownloadError } from '../../errors/custom-errors.js';
import type { MgtvStream } from './mgtv-api.js';

export type PickedStream = {
  stream: MgtvStream;
  /** True when a higher-bitrate (VIP) stream existed but was locked (empty url). */
  degraded: boolean;
};

/**
 * Pick the best downloadable stream: highest numeric filebitrate among
 * streams with a non-empty url. Locked VIP streams (empty url = cookies
 * missing/expired or no VIP) are skipped and reported via `degraded`.
 */
export function pickBestStream(streams: MgtvStream[]): PickedStream {
  const bitrate = (s: MgtvStream) => Number(s.filebitrate) || 0;

  const bestOverall = streams.reduce<MgtvStream | null>(
    (a, b) => (a === null || bitrate(b) > bitrate(a) ? b : a),
    null,
  );
  if (bestOverall === null) {
    throw new DownloadError('MGTV returned no streams for this episode', '');
  }

  const usable = streams.filter((s) => s.url.length > 0);
  const bestUsable = usable.reduce<MgtvStream | null>((a, b) => (a === null || bitrate(b) > bitrate(a) ? b : a), null);
  if (bestUsable === null) {
    throw new DownloadError('All MGTV streams are locked — cookies missing/expired or the account has no VIP', '');
  }

  return { stream: bestUsable, degraded: bitrate(bestOverall) > bitrate(bestUsable) };
}
