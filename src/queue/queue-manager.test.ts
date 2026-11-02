import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { AppContext } from '../app-context';
import { ConfigRegistry } from '../config/config-registry';
import { NotificationLevel } from '../notifications/notification-level';
import { queueModuleRestore } from '../test-utils/queue-module-restore';
import { EpisodeType } from '../types/episode-type';
import { QueueManager } from './queue-manager';

// Mock dependencies
const mockStateManager = {
  getDownloadedCount: mock(() => 0),
  isDownloaded: mock(() => false),
} as any;

const mockDownloadManager = {
  download: mock(() => Promise.resolve()),
} as any;

const mockNotifier = {
  notify: mock(() => Promise.resolve()),
  progress: mock(() => {}),
  endProgress: mock(() => {}),
};

// Mock HandlerRegistry
const mockHandler = {
  extractEpisodes: mock(() => Promise.resolve([])),
};

mock.module('../handlers/handler-registry.js', () => ({
  handlerRegistry: {
    getHandlerOrThrow: mock(() => mockHandler),
  },
}));
queueModuleRestore('../handlers/handler-registry.js', import.meta.dir);

// Mock Firefox cookie reader
const mockReadCookieHeaderForUrl = mock(() => Promise.resolve(''));

mock.module('../utils/firefox-cookies', () => ({
  readCookieHeaderForUrl: mockReadCookieHeaderForUrl,
}));
queueModuleRestore('../utils/firefox-cookies', import.meta.dir);

describe('QueueManager', () => {
  let queueManager: QueueManager;
  let mockScheduler: any;
  let schedulerExecutor: any;

  beforeEach(() => {
    // Reset mocks
    mockNotifier.notify.mockClear();
    mockDownloadManager.download.mockClear();
    mockHandler.extractEpisodes.mockClear();
    mockHandler.extractEpisodes.mockResolvedValue([]);
    mockStateManager.isDownloaded.mockClear();
    mockStateManager.isDownloaded.mockReturnValue(false);
    mockReadCookieHeaderForUrl.mockClear();
    mockReadCookieHeaderForUrl.mockResolvedValue('');

    // Initialize AppContext for tests
    // Create a proper config structure for testing
    const mockConfig = {
      series: [
        {
          name: 'Test Series',
          url: 'https://wetv.vip/play/123',
          startTime: '12:00',
          download: { downloadDelay: 10 }, // 10s default for tests
        },
      ],
      stateFile: 'test-state.json',
      browser: 'chrome' as const,
    };
    const configRegistry = new ConfigRegistry(mockConfig as any);
    AppContext.initialize(configRegistry, mockNotifier as any);

    // Create mock scheduler
    mockScheduler = {
      registerQueue: mock(() => {}),
      hasQueue: mock(() => false),
      addTask: mock(() => {}),
      addPriorityTask: mock(() => {}),
      resume: mock(() => {}),
      stop: mock(() => Promise.resolve()),
      getStats: mock(() => new Map()),
      isExecutorBusy: mock(() => false),
      markTaskComplete: mock(() => {}),
      setOnWait: mock(() => {}),
    };

    // Factory to capture executor and return mock scheduler
    const schedulerFactory = (executor: any) => {
      schedulerExecutor = executor;
      return mockScheduler;
    };

    queueManager = new QueueManager(mockDownloadManager, schedulerFactory as any);
  });

  it('should initialize correctly', () => {
    expect(queueManager).toBeDefined();
    expect(schedulerExecutor).toBeDefined();
  });

  it('should start and stop scheduler', async () => {
    queueManager.start();
    expect(mockScheduler.resume).toHaveBeenCalled();
    // Note: Started/Stopped messages are now DEBUG, so we don't expect them to be notified

    await queueManager.stop();
    expect(mockScheduler.stop).toHaveBeenCalled();
  });

  it('should clean up event listeners on stop', async () => {
    const { EventBus } = await import('../events/event-bus');
    const eventBus = new EventBus();
    const managerWithBus = new QueueManager(mockDownloadManager, undefined as any, eventBus);

    const eventNames = [
      'queue:task:start',
      'queue:task:complete',
      'queue:task:error',
      'queue:idle',
      'queue:wait',
    ] as const;

    // Listeners registered in constructor
    for (const name of eventNames) {
      expect(eventBus.listenerCount(name)).toBe(1);
    }

    managerWithBus.start();
    await managerWithBus.stop();

    // All listeners removed after stop
    for (const name of eventNames) {
      expect(eventBus.listenerCount(name)).toBe(0);
    }
  });

  it('should throw if started when already running', () => {
    queueManager.start();
    expect(() => queueManager.start()).toThrow('QueueManager is already running');
  });

  it('should add series check task', () => {
    const config = {
      name: 'Test Series',
      url: 'https://wetv.vip/play/123',
      startTime: '12:00',
    };

    queueManager.addSeriesCheck(config.url);

    expect(mockScheduler.addTask).toHaveBeenCalledWith(
      expect.stringMatching(/^check:wetv\.vip:[a-f0-9]{12}$/),
      expect.objectContaining({
        seriesUrl: config.url,
        attemptNumber: 1,
      }),
    );
  });

  it('should add episodes to download queue with series config delay', () => {
    const episodes = [
      { number: 1, url: 'url1', type: EpisodeType.AVAILABLE, extractedAt: new Date() },
      { number: 2, url: 'url2', type: EpisodeType.AVAILABLE, extractedAt: new Date() },
    ];

    queueManager.addEpisodes('https://wetv.vip/play/123', episodes);

    expect(mockScheduler.addTask).toHaveBeenCalledTimes(2);
    // First episode: 0 delay
    expect(mockScheduler.addTask).toHaveBeenCalledWith(
      'download:wetv.vip',
      expect.objectContaining({ episode: episodes[0] }),
      0,
    );
    // Second episode: delay based on pre-configured value (10s) -> 10000ms
    expect(mockScheduler.addTask).toHaveBeenCalledWith(
      'download:wetv.vip',
      expect.objectContaining({ episode: episodes[1] }),
      10000,
    );
  });

  it('should add episodes to download queue', () => {
    const episodes = [
      { number: 1, url: 'url1', type: EpisodeType.AVAILABLE, extractedAt: new Date() },
      { number: 2, url: 'url2', type: EpisodeType.AVAILABLE, extractedAt: new Date() },
    ];

    queueManager.addEpisodes('https://wetv.vip/play/123', episodes);

    expect(mockScheduler.addTask).toHaveBeenCalledTimes(2);
    // First episode: 0 delay
    expect(mockScheduler.addTask).toHaveBeenCalledWith(
      'download:wetv.vip',
      expect.objectContaining({ episode: episodes[0] }),
      0,
    );
    // Second episode: delay based on default (10s) -> 10000ms
    expect(mockScheduler.addTask).toHaveBeenCalledWith(
      'download:wetv.vip',
      expect.objectContaining({ episode: episodes[1] }),
      10000,
    );
  });

  it('should execute check task successfully', async () => {
    // Manually register handler
    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    // Simulate scheduler calling executor
    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockHandler.extractEpisodes).toHaveBeenCalledWith(task.seriesUrl, undefined);
    // Should mark complete
    expect(mockScheduler.markTaskComplete).toHaveBeenCalled();
  });

  it('should pass Firefox cookies to extractEpisodes when cookiesFromBrowser is configured', async () => {
    const configWithCookies = {
      series: [
        {
          name: 'Test Series',
          url: 'https://wetv.vip/play/123',
          startTime: '12:00',
          download: { downloadDelay: 10 },
          cookiesFromBrowser: 'firefox:default-release-1',
        },
      ],
      stateFile: 'test-state.json',
      browser: 'chrome' as const,
    };
    AppContext.initialize(new ConfigRegistry(configWithCookies as any), mockNotifier as any);
    mockReadCookieHeaderForUrl.mockResolvedValue('QC005=abc');

    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockReadCookieHeaderForUrl).toHaveBeenCalledWith('firefox:default-release-1', 'https://wetv.vip/play/123');
    expect(mockHandler.extractEpisodes).toHaveBeenCalledWith('https://wetv.vip/play/123', 'QC005=abc');
  });

  it('should not read cookies when cookiesFromBrowser is not configured', async () => {
    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockReadCookieHeaderForUrl).not.toHaveBeenCalled();
    expect(mockHandler.extractEpisodes).toHaveBeenCalledWith('https://wetv.vip/play/123', undefined);
  });

  it('should warn and proceed when the Firefox profile has no cookies for the domain', async () => {
    const configWithCookies = {
      series: [
        {
          name: 'Test Series',
          url: 'https://wetv.vip/play/123',
          startTime: '12:00',
          download: { downloadDelay: 10 },
          cookiesFromBrowser: 'firefox:default-release-1',
        },
      ],
      stateFile: 'test-state.json',
      browser: 'chrome' as const,
    };
    AppContext.initialize(new ConfigRegistry(configWithCookies as any), mockNotifier as any);
    mockReadCookieHeaderForUrl.mockResolvedValue('');

    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.WARNING,
      expect.stringContaining('Firefox profile has no cookies for this domain'),
    );
    expect(mockHandler.extractEpisodes).toHaveBeenCalledWith('https://wetv.vip/play/123', undefined);
  });

  it('should still run the check when the cookie read fails', async () => {
    const configWithCookies = {
      series: [
        {
          name: 'Test Series',
          url: 'https://wetv.vip/play/123',
          startTime: '12:00',
          download: { downloadDelay: 10 },
          cookiesFromBrowser: 'firefox:default-release-1',
        },
      ],
      stateFile: 'test-state.json',
      browser: 'chrome' as const,
    };
    AppContext.initialize(new ConfigRegistry(configWithCookies as any), mockNotifier as any);
    mockReadCookieHeaderForUrl.mockRejectedValue(new Error('Firefox profile "default-release-1" not found'));

    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockHandler.extractEpisodes).toHaveBeenCalledWith('https://wetv.vip/play/123', undefined);
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.WARNING,
      expect.stringContaining('cookies unavailable'),
    );
    // No failure retry scheduled — the check itself succeeded
    expect(mockScheduler.addPriorityTask).not.toHaveBeenCalled();
  });

  it('should retry a check task on failure with backoff', async () => {
    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);
    mockHandler.extractEpisodes.mockRejectedValue(new Error('boom'));

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.WARNING,
      expect.stringContaining('check retry 1/'),
    );
    // Should requeue with bumped retry count and a backoff delay
    expect(mockScheduler.addPriorityTask).toHaveBeenCalledWith(
      'check:wetv.vip',
      expect.objectContaining({
        seriesUrl: 'https://wetv.vip/play/123',
        attemptNumber: 1,
        retryCount: 1,
      }),
      expect.any(Number),
    );
  });

  it('should requeue check task if no episodes found and retries remaining', async () => {
    // Manually register handler
    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockHandler.extractEpisodes).toHaveBeenCalled();
    // Should requeue with default checkInterval (600s = 600000ms from defaults)
    expect(mockScheduler.addTask).toHaveBeenCalledWith(
      'check:wetv.vip',
      expect.objectContaining({
        attemptNumber: 2,
      }),
      600000, // 600s delay (default checkInterval)
    );
  });

  it('should queue download when episodes found', async () => {
    // Manually register handler
    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    const episodes = [{ number: 1, url: 'url1', type: EpisodeType.AVAILABLE, extractedAt: new Date() }];
    mockHandler.extractEpisodes.mockResolvedValue(episodes as any);

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.SUCCESS,
      expect.stringContaining('1 new episodes'),
    );

    // Should add to download queue
    expect(mockScheduler.addTask).toHaveBeenCalledWith(
      'download:wetv.vip',
      expect.objectContaining({ episode: episodes[0] }),
      0,
    );
  });

  it('should pass express episodes through when express is in check.downloadTypes', async () => {
    const configWithExpress = {
      series: [
        {
          name: 'Test Series',
          url: 'https://wetv.vip/play/123',
          startTime: '12:00',
          check: { downloadTypes: ['available', 'express'] as EpisodeType[] },
          download: { downloadDelay: 10, subsBeforeVideo: true },
        },
      ],
      stateFile: 'test-state.json',
      browser: 'chrome' as const,
    };
    AppContext.initialize(new ConfigRegistry(configWithExpress as any), mockNotifier as any);

    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const expressEp = [{ number: 4, url: 'url4', type: EpisodeType.EXPRESS, extractedAt: new Date() }];
    mockHandler.extractEpisodes.mockResolvedValue(expressEp as any);

    await schedulerExecutor({ seriesUrl: 'https://wetv.vip/play/123', attemptNumber: 1 }, 'check:wetv.vip');

    expect(mockScheduler.addTask).toHaveBeenCalledWith(
      'download:wetv.vip',
      expect.objectContaining({ episode: expressEp[0] }),
      0,
    );
  });

  it('should filter express episodes out when express is not in downloadTypes even with subsBeforeVideo', async () => {
    const configWithSubsBeforeVideo = {
      series: [
        {
          name: 'Test Series',
          url: 'https://wetv.vip/play/123',
          startTime: '12:00',
          download: { downloadDelay: 10, subsBeforeVideo: true },
        },
      ],
      stateFile: 'test-state.json',
      browser: 'chrome' as const,
    };
    AppContext.initialize(new ConfigRegistry(configWithSubsBeforeVideo as any), mockNotifier as any);

    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const expressEp = [{ number: 4, url: 'url4', type: EpisodeType.EXPRESS, extractedAt: new Date() }];
    mockHandler.extractEpisodes.mockResolvedValue(expressEp as any);

    await schedulerExecutor({ seriesUrl: 'https://wetv.vip/play/123', attemptNumber: 1 }, 'check:wetv.vip');

    // No download task; the check falls into the "no new episodes" requeue flow
    expect(mockScheduler.addTask).not.toHaveBeenCalledWith(
      'download:wetv.vip',
      expect.objectContaining({ episode: expressEp[0] }),
      0,
    );
  });

  it('should execute download task successfully', async () => {
    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      episode: { number: 1, url: 'url1', type: EpisodeType.AVAILABLE, extractedAt: new Date() },
    };

    await schedulerExecutor(task, 'download:wetv.vip');

    expect(mockDownloadManager.download).toHaveBeenCalledWith(task.seriesUrl, task.episode);
    expect(mockScheduler.markTaskComplete).toHaveBeenCalled();
  });

  it('should retry download on failure', async () => {
    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      episode: { number: 1, url: 'url1', type: EpisodeType.AVAILABLE, extractedAt: new Date() },
      retryCount: 0,
    };

    mockDownloadManager.download.mockRejectedValue(new Error('Download failed'));

    await schedulerExecutor(task, 'download:wetv.vip');

    expect(mockNotifier.notify).toHaveBeenCalledWith(NotificationLevel.WARNING, expect.stringContaining('retry 1/3'));

    // Should requeue
    expect(mockScheduler.addPriorityTask).toHaveBeenCalledWith(
      'download:wetv.vip',
      expect.objectContaining({
        retryCount: 1,
      }),
      expect.any(Number), // Backoff delay
    );
  });

  it('should handle unknown queue type', async () => {
    const task = {};
    await expect(schedulerExecutor(task, 'unknown:domain')).rejects.toThrow('Unknown queue type: unknown');
  });

  it('should handle invalid queue name', async () => {
    const task = {};
    await expect(schedulerExecutor(task, 'invalid')).rejects.toThrow('Invalid queue name format');
  });
});
