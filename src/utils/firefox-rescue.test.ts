import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshSessionsViaTab } from './firefox-rescue.js';

// --- execa mock: script-driven process lifetimes ---

type ExecaCall = { file: string; args: string[] };

const execaCalls: ExecaCall[] = [];

/** Default script: the "browser" never exits (alive process). */
let execaScript: (call: ExecaCall, index: number) => Promise<unknown> = () => new Promise<never>(() => {});

const execaMock = mock((file: string, args: string[]): any => {
  const index = execaCalls.length;
  execaCalls.push({ file, args });
  return Object.assign(execaScript({ file, args }, index), { pid: 4242 + index });
});

mock.module('execa', () => ({ execa: execaMock }));

class Deferred<T = { exitCode: number }> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}

// --- profile fixtures (same pattern as firefox-cookies.test.ts) ---

const SPEC = 'firefox:default-release';
const MGTV_URL = 'https://www.mgtv.com/v/1/';
const FUTURE_MS = 4102444800000; // 2100-01-01, user_version=16 → expiry in ms

const tempDirs: string[] = [];
function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ff-rescue-'));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const MOZ_COOKIES_SCHEMA =
  'CREATE TABLE IF NOT EXISTS moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT "", ' +
  'name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER)';

type CookieRow = [name: string, value: string, host: string, path: string, expiry: number, isSecure: number];

function writeProfileDb(dbPath: string, rows: CookieRow[]): void {
  const db = new Database(dbPath);
  db.run(MOZ_COOKIES_SCHEMA);
  db.run('DELETE FROM moz_cookies'); // rows is the full content (re-writes simulate a refreshed session)
  for (const row of rows) {
    db.run('INSERT INTO moz_cookies (name, value, host, path, expiry, isSecure) VALUES (?, ?, ?, ?, ?, ?)', row);
  }
  db.run('PRAGMA user_version = 16');
  db.close();
}

function makeProfileRoot(rows: CookieRow[]): { root: string; dbPath: string } {
  const root = makeTempRoot();
  const profileDir = join(root, 'abc.default-release');
  mkdirSync(profileDir);
  const dbPath = join(profileDir, 'cookies.sqlite');
  writeProfileDb(dbPath, rows);
  return { root, dbPath };
}

describe('refreshSessionsViaTab', () => {
  beforeEach(() => {
    execaCalls.length = 0;
    execaScript = () => new Promise<never>(() => {});
  });

  it('delegates to the running instance on early exit and detects cookie changes', async () => {
    const { root, dbPath } = makeProfileRoot([['sessionId', 's1', '.mgtv.com', '/', FUTURE_MS, 0]]);
    execaScript = async (_call, index) => {
      if (index === 0) {
        // "Firefox" refreshed the session while the tab was open, then exited (delegation)
        writeProfileDb(dbPath, [['sessionId', 's2', '.mgtv.com', '/', FUTURE_MS, 0]]);
        return { exitCode: 0 };
      }
      return { exitCode: 0 };
    };

    const result = await refreshSessionsViaTab(SPEC, MGTV_URL, {
      roots: [root],
      firefoxPath: dbPath, // fine for existsSync
      waitMs: 5_000, // race window; child resolves immediately
      delegatedSettleMs: 10,
    });

    expect(result).toEqual({ outcome: 'delegated', cookiesChanged: true });
    expect(execaCalls[0]).toEqual({ file: dbPath, args: ['-P', 'default-release', '--new-tab', MGTV_URL] });
    expect(execaCalls).toHaveLength(1); // a delegated tab is not ours to close
  });

  it('reports cookiesChanged=false when the visit does not alter the domain cookies', async () => {
    const { root, dbPath } = makeProfileRoot([['sessionId', 's1', '.mgtv.com', '/', FUTURE_MS, 0]]);
    execaScript = async (_call, index) => (index === 0 ? { exitCode: 0 } : { exitCode: 0 });

    const result = await refreshSessionsViaTab(SPEC, MGTV_URL, {
      roots: [root],
      firefoxPath: dbPath,
      waitMs: 5_000,
      delegatedSettleMs: 10,
    });

    expect(result).toEqual({ outcome: 'delegated', cookiesChanged: false });
  });

  it('closes a browser it launched itself, gracefully (no /F)', async () => {
    const { root, dbPath } = makeProfileRoot([['sessionId', 's1', '.mgtv.com', '/', FUTURE_MS, 0]]);
    const firefoxFinished = new Deferred();
    execaScript = (call) => {
      if (call.file !== 'taskkill') return firefoxFinished.promise; // "browser" alive
      // WM_CLOSE: browser closed cleanly — and managed to update cookies
      writeProfileDb(dbPath, [['sessionId', 's2', '.mgtv.com', '/', FUTURE_MS, 0]]);
      firefoxFinished.resolve({ exitCode: 0 });
      return Promise.resolve({ exitCode: 0 });
    };

    const result = await refreshSessionsViaTab(SPEC, MGTV_URL, {
      roots: [root],
      firefoxPath: dbPath,
      waitMs: 30,
      killGraceMs: 5_000,
    });

    expect(result).toEqual({ outcome: 'launched', cookiesChanged: true });
    expect(execaCalls[1]).toEqual({ file: 'taskkill', args: ['/PID', '4242'] });
    expect(execaCalls.some((c) => c.args.includes('/F'))).toBe(false);
  });

  it('force-kills when the graceful close does not finish in time', async () => {
    const { root, dbPath } = makeProfileRoot([['sessionId', 's1', '.mgtv.com', '/', FUTURE_MS, 0]]);
    const firefoxFinished = new Deferred();
    execaScript = (call) => {
      if (call.file !== 'taskkill') return firefoxFinished.promise;
      if (call.args.includes('/F')) {
        firefoxFinished.resolve({ exitCode: 0 });
        return Promise.resolve({ exitCode: 0 });
      }
      return new Promise<never>(() => {}); // graceful close ignored
    };

    const result = await refreshSessionsViaTab(SPEC, MGTV_URL, {
      roots: [root],
      firefoxPath: dbPath,
      waitMs: 30,
      killGraceMs: 30,
    });

    expect(result).toEqual({ outcome: 'launched', cookiesChanged: false });
    expect(execaCalls[2]?.args).toEqual(['/PID', '4242', '/F']);
  });

  it('skips when the profile directory does not exist', async () => {
    const root = makeTempRoot(); // no profile dir inside

    const result = await refreshSessionsViaTab(SPEC, MGTV_URL, { roots: [root], firefoxPath: root });

    expect(result.outcome).toBe('skipped');
    expect(result.skipReason).toMatch(/not found/);
    expect(execaCalls).toHaveLength(0);
  });

  it('skips when firefox.exe cannot be found', async () => {
    const root = makeTempRoot();

    const result = await refreshSessionsViaTab(SPEC, MGTV_URL, {
      roots: [root],
      firefoxPath: join(root, 'missing.exe'),
    });

    expect(result).toEqual({ outcome: 'skipped', cookiesChanged: false, skipReason: 'firefox.exe not found' });
    expect(execaCalls).toHaveLength(0);
  });

  it('skips on a non-firefox spec', async () => {
    const root = makeTempRoot();

    const result = await refreshSessionsViaTab('chrome:x', MGTV_URL, { roots: [root], firefoxPath: root });

    expect(result.outcome).toBe('skipped');
    expect(result.skipReason).toMatch(/only "firefox:/);
    expect(execaCalls).toHaveLength(0);
  });
});
