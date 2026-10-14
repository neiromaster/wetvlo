import { describe, expect, it } from 'bun:test';
import { extractVideoId, makeTk2 } from './mgtv-api';

describe('makeTk2', () => {
  it('produces the golden-vector signature for a fixed did and clit', () => {
    // Verified against the live MGTV player (2026-10-14)
    expect(makeTk2('00000000-0000-4000-8000-000000000000', 1700000000)).toBe(
      'wADMwADMwAzNx0Ddpx2Y8FDMzAjLz4CM9IXZ2xHMzATM98mbwxHMwADMwADMwADMwATLwADM40CMwADNtADMwATLwADMwADMwATPklGZ',
    );
  });

  it('defaults clit to current unix time when omitted', () => {
    const tk2 = makeTk2('11111111-1111-4111-8111-111111111111');
    expect(typeof tk2).toBe('string');
    expect(tk2.length).toBeGreaterThan(0);
    // reversed URL-safe base64 never contains raw '+', '/', '='
    expect(tk2).not.toMatch(/[+/=]/);
  });
});

describe('extractVideoId', () => {
  it('extracts the id from a w.mgtv.com episode URL', () => {
    expect(extractVideoId('https://w.mgtv.com/b/908834/24677071.html')).toBe('24677071');
  });

  it('extracts the id from a mgtv.com episode URL', () => {
    expect(extractVideoId('https://mgtv.com/b/823701/23967831.html')).toBe('23967831');
  });

  it('returns null for URLs without an episode path', () => {
    expect(extractVideoId('https://w.mgtv.com/some/other/page')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(extractVideoId('not a url')).toBeNull();
  });
});
