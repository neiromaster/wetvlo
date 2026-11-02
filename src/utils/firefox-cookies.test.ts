import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppContext } from '../app-context';
import { CookieError } from '../errors/custom-errors.js';
import { NotificationLevel } from '../notifications/notification-level.js';
import { findProfileDir, parseCookieBrowserSpec } from './firefox-cookies.js';

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ff-profiles-'));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  AppContext.reset();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
    const root = makeTempRoot();
    mkdirSync(join(root, 'abc123.default-release-1'));
    expect(findProfileDir('abc123.default-release-1', [root])).toBe(join(root, 'abc123.default-release-1'));
  });

  it('matches a <hash>.<profile> suffix', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, 'abc123.default-release-1'));
    expect(findProfileDir('default-release-1', [root])).toBe(join(root, 'abc123.default-release-1'));
  });

  it('takes the lexically first of several matches', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, 'zzz.default-release-1'));
    mkdirSync(join(root, 'aaa.default-release-1'));
    expect(findProfileDir('default-release-1', [root])).toBe(join(root, 'aaa.default-release-1'));
  });

  it('ignores files that merely look like profile directories', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, 'zzz.default-release'));
    writeFileSync(join(root, 'aaa.default-release'), 'not a profile');
    // "aaa." sorts before "zzz." — the file must not win just by lexical order
    expect(findProfileDir('default-release', [root])).toBe(join(root, 'zzz.default-release'));
  });

  it('warns through the notifier when several profiles match', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, 'zzz.default-release'));
    mkdirSync(join(root, 'aaa.default-release'));
    const notifier = {
      notify: mock(() => Promise.resolve()),
      progress: mock(() => {}),
      endProgress: mock(() => {}),
    };
    AppContext.initialize({} as any, notifier as any);

    expect(findProfileDir('default-release', [root])).toBe(join(root, 'aaa.default-release'));
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledWith(NotificationLevel.WARNING, expect.stringContaining('default-release'));
  });

  it('throws CookieError listing the searched roots when not found', () => {
    const root = makeTempRoot();
    expect(() => findProfileDir('nope', [root])).toThrow(CookieError);
    expect(() => findProfileDir('nope', [root])).toThrow(/nope/);
  });

  it('throws CookieError naming the missing roots when the roots list is empty', () => {
    expect(() => findProfileDir('x', [])).toThrow(CookieError);
    expect(() => findProfileDir('x', [])).toThrow(/\(no profile roots found\)/);
  });

  it('skips roots that do not exist (no MS Store Firefox)', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, 'abc123.default-release'));
    expect(findProfileDir('default-release', [join(root, 'missing'), root])).toBe(join(root, 'abc123.default-release'));
  });
});
