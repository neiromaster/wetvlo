import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { type AppDependencies, handleShutdown, runApp } from './app.js';
import type { Config } from './types/config.types.js';

describe('App', () => {
  let _exitSpy: any;
  let mockScheduler: any;
  let mockStateManager: any;
  let mockDownloadManager: any;
  let mockConfig: Config;

  beforeEach(() => {
    _exitSpy = spyOn(process, 'exit').mockImplementation((() => {}) as any);

    mockScheduler = {
      start: mock(() => Promise.resolve()),
      stop: mock(() => Promise.resolve()),
    };

    mockStateManager = {
      load: mock(() => Promise.resolve()),
      save: mock(() => Promise.resolve()),
      getDownloadedCount: mock(() => 0),
    };

    mockDownloadManager = {};

    mockConfig = {
      series: [],
      stateFile: 'state.json',
      browser: 'chrome',
    };
  });

  afterEach(() => {
    mock.restore();
  });

  const createMockDeps = (overrides: Partial<AppDependencies> = {}): AppDependencies => ({
    loadConfig: mock(() => Promise.resolve(mockConfig)) as any,
    checkYtDlpInstalled: mock(() => Promise.resolve(true)),
    readCookieFile: mock(() => Promise.resolve('cookies')),
    createStateManager: mock(() => mockStateManager),
    createDownloadManager: mock(() => mockDownloadManager),
    createScheduler: mock(() => mockScheduler),
    ...overrides,
  });

  it('runApp should run successfully in scheduled mode', async () => {
    const deps = createMockDeps();
    await runApp('config.yaml', 'scheduled', deps);

    expect(deps.checkYtDlpInstalled).toHaveBeenCalled();
    expect(deps.loadConfig).toHaveBeenCalledWith('config.yaml');
    expect(deps.createStateManager).toHaveBeenCalledWith('state.json');
    expect(mockStateManager.load).toHaveBeenCalled();
    expect(deps.createDownloadManager).toHaveBeenCalled();
    expect(deps.createScheduler).toHaveBeenCalled();
    expect(mockScheduler.start).toHaveBeenCalled();
  });

  it('runApp should check yt-dlp and throw if not installed', async () => {
    const deps = createMockDeps({
      checkYtDlpInstalled: mock(() => Promise.resolve(false)),
    });

    await expect(runApp('config.yaml', 'once', deps)).rejects.toThrow('yt-dlp is not installed');
  });

  it('handleShutdown should stop scheduler and save state', async () => {
    await handleShutdown(mockScheduler, mockStateManager);

    expect(mockScheduler.stop).toHaveBeenCalled();
    expect(mockStateManager.save).toHaveBeenCalled();
  });
});
