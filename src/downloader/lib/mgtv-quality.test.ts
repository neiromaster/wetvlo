import { describe, expect, it } from 'bun:test';
import { DownloadError } from '../../errors/custom-errors.js';
import type { MgtvStream } from './mgtv-api';
import { pickBestStream } from './mgtv-quality';

function stream(name: string, filebitrate: string, url = '/atcl/x', vip = '0'): MgtvStream {
  return { name, filebitrate, vip, url };
}

describe('pickBestStream', () => {
  it('picks the highest filebitrate numerically (1541 > 757 > 605 > 445)', () => {
    const streams = [
      stream('480P', '445'),
      stream('1080P SDR', '1541', '/atcl/1080', '1'),
      stream('720P', '757'),
      stream('576P', '605'),
    ];
    const { stream: best, degraded } = pickBestStream(streams);
    expect(best.name).toBe('1080P SDR');
    expect(degraded).toBe(false);
  });

  it('skips locked streams (empty url) and flags degraded', () => {
    const streams = [
      stream('480P', '445'),
      stream('720P', '757'),
      stream('1080P SDR', '1541', '', '1'), // locked: empty url
    ];
    const { stream: best, degraded } = pickBestStream(streams);
    expect(best.name).toBe('720P');
    expect(degraded).toBe(true);
  });

  it('compares bitrates as numbers, not strings ("1000" > "999")', () => {
    const { stream: best } = pickBestStream([stream('A', '999'), stream('B', '1000')]);
    expect(best.name).toBe('B');
  });

  it('handles filebitrate values that are not numeric by treating them as 0', () => {
    const { stream: best } = pickBestStream([stream('Weird', 'auto'), stream('B', '757')]);
    expect(best.name).toBe('B');
  });

  it('throws DownloadError when there are no streams at all', () => {
    expect(() => pickBestStream([])).toThrow(DownloadError);
  });

  it('throws DownloadError with auth hint when every stream is locked', () => {
    try {
      pickBestStream([stream('1080P SDR', '1541', '', '1')]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DownloadError);
      expect((e as Error).message).toContain('cookies');
    }
  });
});
