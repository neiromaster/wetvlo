import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { AppContext } from '../app-context.js';
import { ConfigRegistry } from '../config/config-registry.js';
import { NotificationLevel } from '../notifications/notifier.js';
import { EpisodeType } from '../types/episode.types.js';
import { QueueManager } from './queue-manager.js';

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

    queueManager = new QueueManager(mockDownloadManager, undefined, schedulerFactory as any);
  });

  it('should initialize correctly', () => {
    expect(queueManager).toBeDefined();
    expect(schedulerExecutor).toBeDefined();
  });

  it('should start and stop scheduler', async () => {
    queueManager.start();
    expect(mockScheduler.resume).toHaveBeenCalled();
    expect(mockNotifier.notify).toHaveBeenCalledWith(NotificationLevel.INFO, expect.stringContaining('Started'));

    await queueManager.stop();
    expect(mockScheduler.stop).toHaveBeenCalled();
    // Case insensitive match or correct case
    expect(mockNotifier.notify).toHaveBeenCalledWith(NotificationLevel.INFO, expect.stringMatching(/stopped/i));
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

    queueManager.addSeriesCheck(config);

    expect(mockScheduler.addTask).toHaveBeenCalledWith(
      expect.stringMatching(/^check:wetv\.vip:[a-f0-9]{12}$/),
      expect.objectContaining({
        seriesUrl: config.url,
        seriesName: config.name,
        attemptNumber: 1,
        config: expect.objectContaining({
          name: config.name,
          url: config.url,
        }),
      }),
    );
  });

  it('should add episodes to download queue with series config delay', () => {
    const episodes = [
      { number: 1, url: 'url1', type: EpisodeType.AVAILABLE, extractedAt: new Date() },
      { number: 2, url: 'url2', type: EpisodeType.AVAILABLE, extractedAt: new Date() },
    ];

    const config = {
      name: 'Test Series',
      url: 'https://wetv.vip/play/123',
      startTime: '12:00',
      download: { downloadDelay: 10 }, // Note: ConfigRegistry uses pre-configured value
    };

    queueManager.addEpisodes('https://wetv.vip/play/123', 'Test Series', episodes, config);

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

    queueManager.addEpisodes('https://wetv.vip/play/123', 'Test Series', episodes);

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
      seriesName: 'Test Series',
      config: { name: 'Test Series', url: 'https://wetv.vip/play/123' },
      attemptNumber: 1,
    };

    // Simulate scheduler calling executor
    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockHandler.extractEpisodes).toHaveBeenCalledWith(task.seriesUrl);
    // Should mark complete
    expect(mockScheduler.markTaskComplete).toHaveBeenCalled();
  });

  it('should requeue check task if no episodes found and retries remaining', async () => {
    // Manually register handler
    (queueManager as any).domainHandlers.set('wetv.vip', mockHandler);

    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      seriesName: 'Test Series',
      config: {
        name: 'Test Series',
        url: 'https://wetv.vip/play/123',
        check: { count: 3 },
      },
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
      seriesName: 'Test Series',
      config: { name: 'Test Series', url: 'https://wetv.vip/play/123' },
      attemptNumber: 1,
    };

    const episodes = [{ number: 1, url: 'url1', type: EpisodeType.AVAILABLE, extractedAt: new Date() }];
    mockHandler.extractEpisodes.mockResolvedValue(episodes as any);

    await schedulerExecutor(task, 'check:wetv.vip');

    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.SUCCESS,
      expect.stringContaining('Found 1 new episodes'),
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
      seriesName: 'Test Series',
      episode: { number: 1, url: 'url1', type: EpisodeType.AVAILABLE, extractedAt: new Date() },
    };

    await schedulerExecutor(task, 'download:wetv.vip');

    expect(mockDownloadManager.download).toHaveBeenCalledWith(task.seriesUrl, task.seriesName, task.episode, 0);
    expect(mockScheduler.markTaskComplete).toHaveBeenCalled();
  });

  it('should retry download on failure', async () => {
    const task = {
      seriesUrl: 'https://wetv.vip/play/123',
      seriesName: 'Test Series',
      episode: { number: 1, url: 'url1', type: EpisodeType.AVAILABLE, extractedAt: new Date() },
      retryCount: 0,
    };

    mockDownloadManager.download.mockRejectedValue(new Error('Download failed'));

    await schedulerExecutor(task, 'download:wetv.vip');

    expect(mockNotifier.notify).toHaveBeenCalledWith(
      NotificationLevel.WARNING,
      expect.stringContaining('Download failed'),
    );

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
