import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieError } from '../errors/custom-errors.js';
import { findProfileDir, parseCookieBrowserSpec } from './firefox-cookies.js';

describe('parseCookieBrowserSpec', () => {
  it('parses firefox:<profile>', () => {
    expect(parseCookieBrowserSpec('firefox:default-release-1')).toEqual({
      browser: 'firefox',
      profile: 'default-release-1',
    });
  });

  it('rejects non-firefox browsers', () => {
    expect(() => parseCookieBrowserSpec('chrome:default')).toThrow(CookieError);
  });

  it('rejects empty profile', () => {
    expect(() => parseCookieBrowserSpec('firefox:')).toThrow(CookieError);
    expect(() => parseCookieBrowserSpec('firefox')).toThrow(CookieError);
  });
});

describe('findProfileDir', () => {
  it('matches an exact directory name', () => {
    const root = mkdtempSync(join(tmpdir(), 'ff-profiles-'));
    mkdirSync(join(root, 'abc123.default-release-1'));
    expect(findProfileDir('abc123.default-release-1', [root])).toBe(join(root, 'abc123.default-release-1'));
  });

  it('matches a <hash>.<profile> suffix', () => {
    const root = mkdtempSync(join(tmpdir(), 'ff-profiles-'));
    mkdirSync(join(root, 'abc123.default-release-1'));
    expect(findProfileDir('default-release-1', [root])).toBe(join(root, 'abc123.default-release-1'));
  });

  it('takes the lexically first of several matches', () => {
    const root = mkdtempSync(join(tmpdir(), 'ff-profiles-'));
    mkdirSync(join(root, 'zzz.default-release-1'));
    mkdirSync(join(root, 'aaa.default-release-1'));
    expect(findProfileDir('default-release-1', [root])).toBe(join(root, 'aaa.default-release-1'));
  });

  it('throws CookieError listing the searched roots when not found', () => {
    const root = mkdtempSync(join(tmpdir(), 'ff-profiles-'));
    expect(() => findProfileDir('nope', [root])).toThrow(CookieError);
    expect(() => findProfileDir('nope', [root])).toThrow(/nope/);
  });

  it('skips roots that do not exist (no MS Store Firefox)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ff-profiles-'));
    mkdirSync(join(root, 'abc123.default-release'));
    expect(findProfileDir('default-release', [join(root, 'missing'), root])).toBe(join(root, 'abc123.default-release'));
  });
});
