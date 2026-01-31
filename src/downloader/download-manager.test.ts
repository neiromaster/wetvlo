import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { AppContext } from '../app-context.js';
import { NotificationLevel } from '../notifications/notifier.js';
import * as VideoValidator from '../utils/video-validator.js';
import { DownloadManager } from './download-manager.js';

// Mock dependencies
const mockStateManager = {
  isDownloaded: mock(() => false),
  addDownloadedEpisode: mock(() => {}),
  save: mock(async () => {}),
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
    mockStateManager.save.mockClear();
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

    // Initialize AppContext with mock notifier
    AppContext.initialize(undefined, [], mockNotifier as any);

    // @ts-expect-error
    downloadManager = new DownloadManager(mockStateManager, '/downloads');

    // Mock verifyDownload to avoid file system check logic inside private method?
    // Actually verifyDownload uses Bun.file(path).size.
    // We cannot easily spy on Bun.file.
    // But since we are testing public methods, we should mock what verifyDownload relies on, OR mock verifyDownload itself.
    // The original test mocked verifyDownload.
    // @ts-expect-error
    downloadManager.verifyDownload = () => 1024 * 1024; // 1MB
  });

  it('should skip download if already downloaded', async () => {
    mockStateManager.isDownloaded.mockReturnValue(true);

    const result = await downloadManager.download('url', 'Series', { number: 1, url: 'url' } as any);

    expect(result).toBe(false);
    expect(mockNotifier.notify).not.toHaveBeenCalled();
  });

  it('should download if not present', async () => {
    mockStateManager.isDownloaded.mockReturnValue(false);

    const result = await downloadManager.download('url', 'Series', { number: 1, url: 'url' } as any);

    expect(result).toBe(true);
    expect(mockStateManager.addDownloadedEpisode).toHaveBeenCalled();
    expect(mockStateManager.save).toHaveBeenCalled();
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.HIGHLIGHT,
      expect.stringContaining('Downloading'),
    );
    expect(mockNotifier.notify).toHaveBeenCalledWith(NotificationLevel.SUCCESS, expect.stringContaining('Downloaded'));
  });

  it('should download to temp dir and move files', async () => {
    // Re-init with temp dir
    // @ts-expect-error
    downloadManager = new DownloadManager(mockStateManager, '/downloads', undefined, '/temp');
    // Mock verifyDownload to avoid file system check
    // @ts-expect-error
    downloadManager.verifyDownload = () => 1024 * 1024; // 1MB

    mockStateManager.isDownloaded.mockReturnValue(false);

    const result = await downloadManager.download('url', 'Series', { number: 1, url: 'url' } as any);

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
    mockStateManager.isDownloaded.mockReturnValue(false);
    getVideoDurationSpy.mockResolvedValue(100);

    const result = await downloadManager.download(
      'url',
      'Series',
      { number: 1, url: 'url' } as any,
      50, // minDuration
    );

    expect(result).toBe(true);
    expect(getVideoDurationSpy).toHaveBeenCalled();
  });

  it('should throw error and delete file if video duration is too short', async () => {
    mockStateManager.isDownloaded.mockReturnValue(false);
    getVideoDurationSpy.mockResolvedValue(30); // 30s < 50s

    await expect(
      downloadManager.download(
        'url',
        'Series',
        { number: 1, url: 'url' } as any,
        50, // minDuration
      ),
    ).rejects.toThrow('Video duration 30s is less than minimum 50s');

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
