import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppContext } from '../app-context';
import { ConfigRegistry } from '../config/config-registry';
import { NotificationLevel } from '../notifications/notification-level';
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

// Mock CookieRefreshManager singleton
const mockRefreshCookies = mock(() => Promise.resolve());

mock.module('../utils/cookie-sync', () => ({
  CookieRefreshManager: {
    getInstance: () => ({ refreshCookies: mockRefreshCookies }),
  },
}));

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
    mockRefreshCookies.mockClear();
    mockRefreshCookies.mockResolvedValue(undefined as any);

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

  it('should pass domain-scoped cookies to extractEpisodes when cookieFile is configured', async () => {
    const cookieFile = join(tmpdir(), `qm-cookies-${Date.now()}.txt`);
    writeFileSync(
      cookieFile,
      [
        '# Netscape HTTP Cookie File',
        '',
        '.wetv.vip\tTRUE\t/\tTRUE\t2147483647\twt_token\tabc123',
        'openai.com\tTRUE\t/\tTRUE\t2147483647\topenai_sid\toai456',
      ].join('\n'),
    );

    try {
      const configWithCookies = {
        series: [
          {
            name: 'Test Series',
            url: 'https://wetv.vip/play/123',
            startTime: '12:00',
            download: { downloadDelay: 10 },
            cookieFile,
          },
        ],
        stateFile: 'test-state.json',
        browser: 'chrome' as const,
      };
      AppContext.initialize(new ConfigRegistry(configWithCookies as any), mockNotifier as any);

      (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

      const task = {
        seriesUrl: 'https://wetv.vip/play/123',
        attemptNumber: 1,
      };

      await schedulerExecutor(task, 'check:wetv.vip');

      expect(mockHandler.extractEpisodes).toHaveBeenCalledWith('https://wetv.vip/play/123', 'wt_token=abc123');
    } finally {
      if (existsSync(cookieFile)) {
        unlinkSync(cookieFile);
      }
    }
  });

  it('should pass undefined cookies when cookieFile is not configured', async () => {
    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockHandler.extractEpisodes).toHaveBeenCalledWith('https://wetv.vip/play/123', undefined);
  });

  it('should refresh cookies when a check fails and cookieRefreshBrowser is configured', async () => {
    const configWithRefresh = {
      series: [
        {
          name: 'Test Series',
          url: 'https://wetv.vip/play/123',
          startTime: '12:00',
          download: { downloadDelay: 10 },
          cookieRefreshBrowser: 'firefox',
        },
      ],
      stateFile: 'test-state.json',
      browser: 'chrome' as const,
    };
    AppContext.initialize(new ConfigRegistry(configWithRefresh as any), mockNotifier as any);

    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);
    mockHandler.extractEpisodes.mockRejectedValue(new Error('HTTP Error 413'));

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockRefreshCookies).toHaveBeenCalledWith('https://wetv.vip/play/123');
    // Retry is still scheduled after the refresh attempt
    expect(mockScheduler.addPriorityTask).toHaveBeenCalled();
  });

  it('should not refresh cookies when a check fails without cookieRefreshBrowser', async () => {
    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);
    mockHandler.extractEpisodes.mockRejectedValue(new Error('HTTP Error 413'));

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockRefreshCookies).not.toHaveBeenCalled();
    expect(mockScheduler.addPriorityTask).toHaveBeenCalled();
  });

  it('should still schedule check retry when cookie refresh fails', async () => {
    const configWithRefresh = {
      series: [
        {
          name: 'Test Series',
          url: 'https://wetv.vip/play/123',
          startTime: '12:00',
          download: { downloadDelay: 10 },
          cookieRefreshBrowser: 'firefox',
        },
      ],
      stateFile: 'test-state.json',
      browser: 'chrome' as const,
    };
    AppContext.initialize(new ConfigRegistry(configWithRefresh as any), mockNotifier as any);

    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);
    mockHandler.extractEpisodes.mockRejectedValue(new Error('HTTP Error 413'));
    mockRefreshCookies.mockRejectedValue(new Error('page.goto: NS_ERROR_NET_EMPTY_RESPONSE'));

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockRefreshCookies).toHaveBeenCalledWith('https://wetv.vip/play/123');
    expect(mockScheduler.addPriorityTask).toHaveBeenCalled();
  });

  it('should proceed without cookies when cookieFile points to a missing file', async () => {
    const configWithMissingCookies = {
      series: [
        {
          name: 'Test Series',
          url: 'https://wetv.vip/play/123',
          startTime: '12:00',
          download: { downloadDelay: 10 },
          cookieFile: join(tmpdir(), `qm-missing-${Date.now()}.txt`),
        },
      ],
      stateFile: 'test-state.json',
      browser: 'chrome' as const,
    };
    AppContext.initialize(new ConfigRegistry(configWithMissingCookies as any), mockNotifier as any);

    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      attemptNumber: 1,
    };

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockHandler.extractEpisodes).toHaveBeenCalledWith('https://wetv.vip/play/123', undefined);
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.WARNING,
      expect.stringContaining('cookie file unreadable'),
    );
    // Check still completes
    expect(mockScheduler.markTaskComplete).toHaveBeenCalled();
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
