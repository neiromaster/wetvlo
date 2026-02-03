import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { type AppDependencies, runApp } from './app.js';
import type { Config } from './config/config-schema.js';

describe('App Interactive Mode', () => {
  let _exitSpy: any;
  let mockScheduler: any;
  let mockDownloadManager: any;
  let mockConfig: Config;
  let stdinListeners: Record<string, Function> = {};
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    _exitSpy = spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Mock scheduler with interactive methods
    mockScheduler = {
      start: mock(() => Promise.resolve()),
      stop: mock(() => Promise.resolve()),
      triggerAllChecks: mock(() => Promise.resolve()),
      reload: mock(() => Promise.resolve()),
    };

    mockDownloadManager = {};

    mockConfig = {
      series: [],
      stateFile: 'state.json',
      browser: 'chrome' as const,
    } as any;

    // Mock process.stdin
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });

    // Mock setRawMode
    (process.stdin as any).setRawMode = mock(() => {});

    // Mock event listeners
    stdinListeners = {};
    spyOn(process.stdin, 'on').mockImplementation((event: string, callback: Function) => {
      stdinListeners[event] = callback;
      return process.stdin;
    });
  });

  afterEach(() => {
    mock.restore();
    if (originalIsTTY !== undefined) {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  const createMockDeps = (overrides: Partial<AppDependencies> = {}): AppDependencies => ({
    loadConfig: mock(() => Promise.resolve(mockConfig)) as any,
    checkYtDlpInstalled: mock(() => Promise.resolve(true)),
    readCookieFile: mock(() => Promise.resolve('cookies')),
    createDownloadManager: mock(() => mockDownloadManager),
    createScheduler: mock(() => mockScheduler),
    ...overrides,
  });

  const emitKeypress = (name: string, ctrl = false, strOverride?: string) => {
    if (stdinListeners.keypress) {
      stdinListeners.keypress(strOverride !== undefined ? strOverride : name, { name, ctrl });
    }
  };

  const waitForAsync = () => new Promise((resolve) => setTimeout(resolve, 10));

  it('should trigger checks on "c" key', async () => {
    const deps = createMockDeps();
    await runApp('config.yaml', 'scheduled', deps);

    emitKeypress('c');
    await waitForAsync();
    expect(mockScheduler.triggerAllChecks).toHaveBeenCalled();
  });

  it('should trigger checks on "с" (Cyrillic) key', async () => {
    const deps = createMockDeps();
    await runApp('config.yaml', 'scheduled', deps);

    emitKeypress('с');
    await waitForAsync();
    expect(mockScheduler.triggerAllChecks).toHaveBeenCalled();
  });

  it('should trigger checks on "с" (Cyrillic) key when key.name is undefined', async () => {
    const deps = createMockDeps();
    await runApp('config.yaml', 'scheduled', deps);

    // Simulate behavior where key.name is undefined but str is 'с'
    emitKeypress(undefined as any, false, 'с');
    await waitForAsync();
    expect(mockScheduler.triggerAllChecks).toHaveBeenCalled();
  });

  it('should reload config on "r" key', async () => {
    const deps = createMockDeps();
    await runApp('config.yaml', 'scheduled', deps);

    emitKeypress('r');
    await waitForAsync();
    expect(mockScheduler.reload).toHaveBeenCalled();
    expect(deps.loadConfig).toHaveBeenCalledTimes(2); // Once initial, once reload
  });

  it('should reload config on "к" (Cyrillic) key', async () => {
    const deps = createMockDeps();
    await runApp('config.yaml', 'scheduled', deps);

    emitKeypress('к');
    await waitForAsync();
    expect(mockScheduler.reload).toHaveBeenCalled();
  });

  it('should quit on "q" key', async () => {
    const deps = createMockDeps();
    await runApp('config.yaml', 'scheduled', deps);

    emitKeypress('q');
    await waitForAsync();
    expect(mockScheduler.stop).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should quit on "й" (Cyrillic) key', async () => {
    const deps = createMockDeps();
    await runApp('config.yaml', 'scheduled', deps);

    emitKeypress('й');
    await waitForAsync();
    expect(mockScheduler.stop).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
