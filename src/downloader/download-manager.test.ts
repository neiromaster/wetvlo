import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NotificationLevel } from '../notifications/notifier.js';
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

describe('DownloadManager', () => {
  let downloadManager: DownloadManager;

  beforeEach(() => {
    mockStateManager.isDownloaded.mockClear();
    mockStateManager.addDownloadedEpisode.mockClear();
    mockStateManager.save.mockClear();
    mockNotifier.notify.mockClear();
    mockNotifier.progress.mockClear();
    mockNotifier.endProgress.mockClear();

    // @ts-expect-error
    downloadManager = new DownloadManager(mockStateManager, mockNotifier, '/downloads');

    // Mock verifyDownload to avoid file system check
    // We can't easily spy/mock private method, so we might need to mock Bun.file or use prototype injection
    // Using prototype injection for verifyDownload
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
});
