import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
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
  notify: mock(() => {}),
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

// Mock fs/promises
const mockUnlink = mock(async () => {});
const mockMkdir = mock(async () => {});
const mockRename = mock(async () => {});
const mockStat = mock(async () => ({ size: 1024 }));

mock.module('node:fs/promises', () => ({
  unlink: mockUnlink,
  mkdir: mockMkdir,
  rename: mockRename,
  stat: mockStat,
}));

// Mock node:fs
mock.module('node:fs', () => ({
  existsSync: mock(() => true),
}));

// Mock node:path
mock.module('node:path', () => ({
  basename: (p: string) => p.split('/').pop() || '',
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  join: (...args: string[]) => args.join('/').replace(/\/+/g, '/'),
  resolve: (p: string) => (p.startsWith('/') ? p : `/${p}`),
}));

describe('DownloadManager', () => {
  let downloadManager: DownloadManager;

  afterAll(() => {
    getVideoDurationSpy.mockRestore();
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
    mockUnlink.mockClear();
    mockMkdir.mockClear();
    mockRename.mockClear();

    // @ts-expect-error
    downloadManager = new DownloadManager(mockStateManager, mockNotifier, '/downloads');

    // Mock verifyDownload to avoid file system check
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
    downloadManager = new DownloadManager(mockStateManager, mockNotifier, '/downloads', undefined, '/temp');
    // Mock verifyDownload to avoid file system check
    // @ts-expect-error
    downloadManager.verifyDownload = () => 1024 * 1024; // 1MB

    mockStateManager.isDownloaded.mockReturnValue(false);

    const result = await downloadManager.download('url', 'Series', { number: 1, url: 'url' } as any);

    expect(result).toBe(true);
    // Check if directories were created
    expect(mockMkdir).toHaveBeenCalledWith('/temp', { recursive: true });
    expect(mockMkdir).toHaveBeenCalledWith('/downloads', { recursive: true });

    // Check if rename was called for the file
    // The mock execa output returns 'test-file.mp4', which is resolved to '/test-file.mp4'
    expect(mockRename).toHaveBeenCalledWith('/test-file.mp4', '/downloads/test-file.mp4');
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
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('test-file.mp4'));

    // Verify NOT downloaded
    expect(mockStateManager.addDownloadedEpisode).not.toHaveBeenCalled();
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.ERROR,
      expect.stringContaining('Video duration'),
    );
  });
});
