import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { AppContext } from '../app-context';
import { NotificationLevel } from '../notifications/notification-level';
import * as VideoValidator from '../utils/video-validator';
import { DownloadManager } from './download-manager';

// Mock StateManager
const mockStateManager = {
  isDownloaded: mock(() => false),
  addDownloadedEpisode: mock(async () => {}),
  getSeriesEpisodes: mock(() => []),
};

const mockNotifier = {
  notify: mock(() => Promise.resolve()),
  progress: mock(() => {}),
  endProgress: mock(() => {}),
};

// Mock execa
mock.module('execa', () => ({
  execa: mock(() => {
    // Return a mock subprocess
    const subprocess = Promise.resolve({ stdout: 'Done', stderr: '' });
    // @ts-expect-error
    subprocess.all = (async function* () {
      yield '[download] Destination: test-file.mp4';
      yield '[download] 100% of 10MB at 1MB/s ETA 00:00';
    })();
    return subprocess;
  }),
}));

// Mock VideoValidator
const getVideoDurationSpy = spyOn(VideoValidator, 'getVideoDuration');
getVideoDurationSpy.mockImplementation(async () => 100);

// Spies for fs
const existsSyncSpy = spyOn(fs, 'existsSync');
const mkdirSpy = spyOn(fsPromises, 'mkdir');
const renameSpy = spyOn(fsPromises, 'rename');
const unlinkSpy = spyOn(fsPromises, 'unlink');
const statSpy = spyOn(fsPromises, 'stat');

// Mock ConfigRegistry
const mockConfigRegistry = {
  resolve: mock(() => ({
    stateFile: 'state.json',
    name: 'Test Series',
    download: { downloadDir: '/downloads', tempDir: undefined, minDuration: 0 },
    cookieFile: undefined,
  })),
  getConfig: mock(() => ({
    telegram: undefined,
    cookieFile: undefined,
    download: { downloadDir: '/downloads', tempDir: undefined },
  })),
};

describe('DownloadManager', () => {
  let downloadManager: DownloadManager;

  afterAll(() => {
    getVideoDurationSpy.mockRestore();
    existsSyncSpy.mockRestore();
    mkdirSpy.mockRestore();
    renameSpy.mockRestore();
    unlinkSpy.mockRestore();
    statSpy.mockRestore();
  });

  afterEach(() => {
    AppContext.reset();
  });

  beforeEach(() => {
    mockStateManager.isDownloaded.mockClear();
    mockStateManager.addDownloadedEpisode.mockClear();
    mockNotifier.notify.mockClear();
    mockNotifier.progress.mockClear();
    mockNotifier.endProgress.mockClear();
    getVideoDurationSpy.mockClear();
    getVideoDurationSpy.mockImplementation(async () => 100); // Reset to default

    // Reset fs spies
    existsSyncSpy.mockClear();
    existsSyncSpy.mockReturnValue(true); // Default to existing files

    mkdirSpy.mockClear();
    mkdirSpy.mockImplementation(async () => undefined);

    renameSpy.mockClear();
    renameSpy.mockImplementation(async () => undefined);

    unlinkSpy.mockClear();
    unlinkSpy.mockImplementation(async () => undefined);

    statSpy.mockClear();
    statSpy.mockImplementation(async () => ({ size: 1024 }) as any);

    // Reset mockConfigRegistry to default
    mockConfigRegistry.resolve.mockReset();
    mockConfigRegistry.resolve.mockImplementation(() => ({
      stateFile: 'state.json',
      name: 'Test Series',
      download: { downloadDir: '/downloads', tempDir: undefined, minDuration: 0 },
      cookieFile: undefined,
    }));

    // Initialize AppContext
    AppContext.initialize(mockConfigRegistry as any, mockNotifier as any, mockStateManager as any);

    downloadManager = new DownloadManager();

    // Mock verifyDownload to avoid file system check
    // @ts-expect-error - testing private method
    downloadManager.verifyDownload = () => 1024 * 1024; // 1MB
  });

  it('should skip download if already downloaded', async () => {
    mockStateManager.isDownloaded.mockReturnValue(true);

    const result = await downloadManager.download('url', { number: 1, url: 'url' } as any);

    expect(result).toBe(false);
    expect(mockNotifier.notify).not.toHaveBeenCalled();
  });

  it('should download if not present', async () => {
    mockStateManager.isDownloaded.mockReturnValue(false);

    const result = await downloadManager.download('url', { number: 1, url: 'url' } as any);

    expect(result).toBe(true);
    expect(mockStateManager.addDownloadedEpisode).toHaveBeenCalled();
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.HIGHLIGHT,
      expect.stringContaining('downloading'),
    );
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.SUCCESS,
      expect.stringContaining('Test Series - 01:'),
    );
  });

  it('should download to temp dir and move files', async () => {
    // Update mock to return tempDir
    mockConfigRegistry.resolve.mockReturnValue({
      stateFile: 'state.json',
      name: 'Test Series',
      download: { downloadDir: '/downloads', tempDir: '/temp', minDuration: 0 },
      cookieFile: undefined,
    } as any);

    mockStateManager.isDownloaded.mockReturnValue(false);

    const result = await downloadManager.download('url', { number: 1, url: 'url' } as any);

    expect(result).toBe(true);
    // Check if directories were created
    // Note: real path resolution will resolve '/temp' to absolute path
    expect(mkdirSpy).toHaveBeenCalled(); // We can't easily assert exact path if resolve is real

    // Check if rename was called for the file
    // The mock execa output returns 'test-file.mp4'.
    // If we use real resolve, 'test-file.mp4' becomes `${cwd}/test-file.mp4`
    // So rename should be called with absolute paths.
    expect(renameSpy).toHaveBeenCalled();
  });

  it('should validate video duration if minDuration > 0', async () => {
    // Update mock to return minDuration > 0
    mockConfigRegistry.resolve.mockReturnValue({
      stateFile: 'state.json',
      name: 'Test Series',
      download: { downloadDir: '/downloads', tempDir: undefined, minDuration: 50 },
      cookieFile: undefined,
    } as any);

    mockStateManager.isDownloaded.mockReturnValue(false);
    getVideoDurationSpy.mockResolvedValue(100);

    const result = await downloadManager.download('url', { number: 1, url: 'url' } as any);

    expect(result).toBe(true);
    expect(getVideoDurationSpy).toHaveBeenCalled();
  });

  it('should throw error and delete file if video duration is too short', async () => {
    // Update mock to return minDuration > 0
    mockConfigRegistry.resolve.mockReturnValue({
      stateFile: 'state.json',
      name: 'Test Series',
      download: { downloadDir: '/downloads', tempDir: undefined, minDuration: 50 },
      cookieFile: undefined,
    } as any);

    mockStateManager.isDownloaded.mockReturnValue(false);
    getVideoDurationSpy.mockResolvedValue(30); // 30s < 50s

    await expect(downloadManager.download('url', { number: 1, url: 'url' } as any)).rejects.toThrow(
      'Video duration 30s is less than minimum 50s',
    );

    expect(getVideoDurationSpy).toHaveBeenCalled();
    // Verify file deletion
    expect(unlinkSpy).toHaveBeenCalled();

    // Verify NOT downloaded
    expect(mockStateManager.addDownloadedEpisode).not.toHaveBeenCalled();
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.ERROR,
      expect.stringContaining('Video duration'),
    );
  });
});
