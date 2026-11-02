import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppContext } from '../app-context';
import { CookieError } from '../errors/custom-errors.js';
import { NotificationLevel } from '../notifications/notification-level.js';
import {
  domainMatchesUrl,
  type FirefoxCookie,
  findProfileDir,
  parseCookieBrowserSpec,
  readCookieHeaderForUrl,
  readFirefoxCookies,
} from './firefox-cookies.js';

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

type CookieRow = [name: string, value: string, host: string, path: string, expiry: number, isSecure: number];

/**
 * Build a fixture cookies.sqlite with the moz_cookies schema Firefox uses.
 * `userVersion` >= 16 (FF142+) means the reader interprets `expiry` as
 * milliseconds; below that as seconds — pass values accordingly.
 */
function makeProfileDb(dbPath: string, userVersion: number, rows: CookieRow[]): void {
  const db = new Database(dbPath);
  db.run(
    'CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT "", ' +
      'name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER)',
  );
  for (const row of rows) {
    db.run('INSERT INTO moz_cookies (name, value, host, path, expiry, isSecure) VALUES (?, ?, ?, ?, ?, ?)', row);
  }
  db.run(`PRAGMA user_version = ${userVersion}`);
  db.close();
}

function cookie(name: string, value: string, host: string, expiry = 0): FirefoxCookie {
  return { name, value, domain: host, path: '/', secure: false, expiry };
}

const SPEC = 'firefox:default-release';
const IQ_URL = 'https://www.iq.com/play/abc';

/** Create a temp root with an "abc.default-release" profile dir inside. */
function makeProfileRoot(): string {
  const root = makeTempRoot();
  mkdirSync(join(root, 'abc.default-release'));
  return root;
}

describe('domainMatchesUrl', () => {
  it('matches exact host, dot-domains and subdomains, but not other hosts', () => {
    expect(domainMatchesUrl('www.iq.com', IQ_URL)).toBe(true);
    expect(domainMatchesUrl('.iq.com', IQ_URL)).toBe(true);
    expect(domainMatchesUrl('iq.com', IQ_URL)).toBe(true);
    expect(domainMatchesUrl('openai.com', IQ_URL)).toBe(false);
    expect(domainMatchesUrl('notiq.com', IQ_URL)).toBe(false);
  });

  it('returns false for an invalid URL', () => {
    expect(domainMatchesUrl('.iq.com', 'not a url')).toBe(false);
  });
});

describe('readFirefoxCookies', () => {
  it('reads cookies and filters them by the URL host', async () => {
    const root = makeProfileRoot();
    makeProfileDb(join(root, 'abc.default-release', 'cookies.sqlite'), 10, [
      ['QC005', 'aaa', '.iq.com', '/', 1900000000, 1],
      ['session', 'bbb', 'www.iq.com', '/', 0, 0],
      ['secret', 'MUST-NOT-LEAK', 'openai.com', '/', 1900000000, 0],
    ]);

    const cookies = await readFirefoxCookies(SPEC, { url: IQ_URL, roots: [root] });

    expect(cookies).toEqual([
      { name: 'QC005', value: 'aaa', domain: '.iq.com', path: '/', secure: true, expiry: 1900000000 },
      { name: 'session', value: 'bbb', domain: 'www.iq.com', path: '/', secure: false, expiry: 0 },
    ]);
  });

  it('drops expired cookies but keeps session cookies (expiry 0)', async () => {
    const root = makeProfileRoot();
    makeProfileDb(join(root, 'abc.default-release', 'cookies.sqlite'), 10, [
      ['old', 'x', '.iq.com', '/', 1000000, 0],
      ['fresh', 'y', '.iq.com', '/', Math.floor(Date.now() / 1000) + 3600, 0],
      ['sess', 'z', '.iq.com', '/', 0, 0],
    ]);

    const names = (await readFirefoxCookies(SPEC, { url: IQ_URL, roots: [root] })).map((c) => c.name);
    expect(names).toEqual(['fresh', 'sess']);
  });

  it('treats expiry as milliseconds on schema version >= 16 (FF142+)', async () => {
    const root = makeProfileRoot();
    const nowMs = Date.now();
    makeProfileDb(join(root, 'abc.default-release', 'cookies.sqlite'), 16, [
      ['msFresh', 'a', '.iq.com', '/', nowMs + 60_000, 0],
      ['msOld', 'b', '.iq.com', '/', nowMs - 60_000, 0],
    ]);

    const names = (await readFirefoxCookies(SPEC, { url: IQ_URL, roots: [root] })).map((c) => c.name);
    expect(names).toEqual(['msFresh']);
  });

  it('dedupes by name|domain keeping the first row', async () => {
    const root = makeProfileRoot();
    makeProfileDb(join(root, 'abc.default-release', 'cookies.sqlite'), 10, [
      ['a', 'first', '.iq.com', '/', 1900000000, 0],
      ['a', 'second', '.iq.com', '/', 1900000000, 0],
    ]);

    const cookies = await readFirefoxCookies(SPEC, { url: IQ_URL, roots: [root] });
    expect(cookies).toEqual([cookie('a', 'first', '.iq.com', 1900000000)]);
  });

  it('works without wal/shm files and throws CookieError without cookies.sqlite', async () => {
    const root = makeProfileRoot();
    makeProfileDb(join(root, 'abc.default-release', 'cookies.sqlite'), 10, [['a', '1', '.iq.com', '/', 0, 0]]);
    expect((await readFirefoxCookies(SPEC, { url: IQ_URL, roots: [root] })).length).toBe(1);

    const root2 = makeProfileRoot();
    await expect(readFirefoxCookies(SPEC, { url: IQ_URL, roots: [root2] })).rejects.toThrow(CookieError);
  });

  it('propagates CookieError for a bad spec', async () => {
    await expect(readFirefoxCookies('chrome:x')).rejects.toThrow(CookieError);
  });
});

describe('readCookieHeaderForUrl', () => {
  it('builds a Cookie header scoped to the URL domain', async () => {
    const root = makeProfileRoot();
    makeProfileDb(join(root, 'abc.default-release', 'cookies.sqlite'), 10, [
      ['a', '1', '.iq.com', '/', 1900000000, 0],
      ['b', '2', 'www.iq.com', '/', 0, 0],
      ['c', '3', 'openai.com', '/', 1900000000, 0],
    ]);

    const header = await readCookieHeaderForUrl(SPEC, IQ_URL, { roots: [root] });
    expect(header).toBe('a=1; b=2');
  });

  it('returns an empty string when nothing matches', async () => {
    const root = makeProfileRoot();
    makeProfileDb(join(root, 'abc.default-release', 'cookies.sqlite'), 10, [
      ['c', '3', 'openai.com', '/', 1900000000, 0],
    ]);

    expect(await readCookieHeaderForUrl(SPEC, IQ_URL, { roots: [root] })).toBe('');
  });
});
