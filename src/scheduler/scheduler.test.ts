import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { AppContext } from '../app-context';
import { NotificationLevel } from '../notifications/notification-level';
import type { EpisodeType } from '../types/episode-type';
import { Scheduler } from './scheduler';

// Define mutable mocks
const mockGetMsUntilTime = mock(() => 0);
const mockGetMsUntilCron = mock(() => 0);
const mockSleep = mock(() => Promise.resolve());

// Mock dependencies
const mockQueueManagerInstance = {
  start: mock(() => {}),
  stop: mock(() => Promise.resolve()),
  addSeriesCheck: mock(() => {}),
  updateConfig: mock(() => {}),
  getQueueStats: mock(() => ({})),
  hasActiveProcessing: mock(() => false),
  clearQueues: mock(() => {}),
  resetQueues: mock(() => {}),
};

// Factory mock
const mockQueueManagerFactory = mock((_downloadManager: any) => mockQueueManagerInstance);

describe('Scheduler', () => {
  let scheduler: Scheduler;
  let _stateManager: any;
  let downloadManager: any;
  let notifier: any;

  const configs = [
    {
      domain: 'example.com',
      name: 'Series 1',
      url: 'http://example.com/1',
      startTime: '10:00',
      check: {
        count: 3,
        checkInterval: 60000,
        downloadTypes: ['available', 'vip', 'svip'] as EpisodeType[],
      },
      download: {
        downloadDir: './downloads',
        tempDir: './temp',
        downloadDelay: 10,
        maxRetries: 2,
        initialTimeout: 5,
        backoffMultiplier: 2,
        jitterPercentage: 10,
        minDuration: 0,
      },
      notifications: {
        consoleMinLevel: 'info' as const,
      },
      stateFile: 'state.json',
    },
    {
      domain: 'example.com',
      name: 'Series 2',
      url: 'http://example.com/2',
      startTime: '10:00',
      check: {
        count: 3,
        checkInterval: 60000,
        downloadTypes: ['available', 'vip', 'svip'] as EpisodeType[],
      },
      download: {
        downloadDir: './downloads',
        tempDir: './temp',
        downloadDelay: 10,
        maxRetries: 2,
        initialTimeout: 5,
        backoffMultiplier: 2,
        jitterPercentage: 10,
        minDuration: 0,
      },
      notifications: {
        consoleMinLevel: 'info' as const,
      },
      stateFile: 'state.json',
    },
    {
      domain: 'example.com',
      name: 'Series 3',
      url: 'http://example.com/3',
      startTime: '10:00',
      check: {
        count: 3,
        checkInterval: 60000,
        downloadTypes: ['available', 'vip', 'svip'] as EpisodeType[],
      },
      download: {
        downloadDir: './downloads',
        tempDir: './temp',
        downloadDelay: 10,
        maxRetries: 2,
        initialTimeout: 5,
        backoffMultiplier: 2,
        jitterPercentage: 10,
        minDuration: 0,
      },
      notifications: {
        consoleMinLevel: 'info' as const,
      },
      stateFile: 'state.json',
    },
  ];

  beforeEach(() => {
    // Reset mocks defaults
    mockGetMsUntilTime.mockReturnValue(0);
    mockGetMsUntilCron.mockReturnValue(0);
    mockSleep.mockReturnValue(Promise.resolve());

    downloadManager = {};
    notifier = {
      notify: mock(() => {}),
      progress: mock(() => {}),
      endProgress: mock(() => {}),
    };

    // Reset queue manager mocks
    mockQueueManagerInstance.start.mockClear();
    mockQueueManagerInstance.stop.mockClear();
    mockQueueManagerInstance.addSeriesCheck.mockClear();
    mockQueueManagerInstance.hasActiveProcessing.mockClear();
    mockQueueManagerInstance.hasActiveProcessing.mockReturnValue(false);
    mockQueueManagerInstance.resetQueues.mockClear();
    mockQueueManagerFactory.mockClear();

    // Reset and initialize AppContext
    AppContext.reset();
    // Mock ConfigRegistry
    const mockConfigRegistry = {
      resolve: mock(() => ({})),
      getConfig: mock(() => ({})),
    } as any;
    AppContext.initialize(mockConfigRegistry, notifier as any);

    // Create scheduler
    scheduler = new Scheduler(
      configs,
      downloadManager,
      { mode: 'scheduled' },
      {
        getMsUntilTime: mockGetMsUntilTime,
        getMsUntilCron: mockGetMsUntilCron,
        sleep: mockSleep,
      },
      mockQueueManagerFactory as any,
    );
  });

  afterEach(() => {
    AppContext.reset();
  });

  it('should initialize queue manager', () => {
    expect(scheduler.getQueueManager()).toBeDefined();
  });

  it('should start scheduler in scheduled mode', async () => {
    // Setup:
    // Return 0 first time to schedule immediately, then large value to wait
    let firstCall = true;
    mockGetMsUntilTime.mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return 0;
      }
      return 100000;
    });

    // Start scheduler (don't await yet as it blocks until stop)
    const startPromise = scheduler.start();

    // Wait for event loop to process setTimeout(0)
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockQueueManagerInstance.start).toHaveBeenCalled();
    expect(notifier.notify).toHaveBeenCalledWith(NotificationLevel.INFO, expect.stringContaining('Scheduler started'));

    // Should add all configs to queue (since delay is 0)
    expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(3);

    // Cleanup
    await scheduler.stop();
    await startPromise;
  });

  it('should start scheduler in once mode', async () => {
    scheduler = new Scheduler(
      configs,
      downloadManager,
      { mode: 'once' },
      {
        getMsUntilTime: mockGetMsUntilTime,
        getMsUntilCron: mockGetMsUntilCron,
        sleep: mockSleep,
      },
      mockQueueManagerFactory as any,
    );

    await scheduler.start();

    expect(mockQueueManagerInstance.start).toHaveBeenCalled();
    // Note: Single-run mode message is now DEBUG, so we don't expect it to be notified

    expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(3);
  });

  it('should stop scheduler', async () => {
    // Make sure it pauses inside the loop so we can stop it safely
    mockGetMsUntilTime.mockReturnValue(10000);
    // Real sleep to ensure it yields control
    mockSleep.mockReturnValue(new Promise((r) => setTimeout(r, 50)));

    // Start without await
    const startPromise = scheduler.start();

    // Stop while it's sleeping
    await scheduler.stop();

    // Should resolve now
    await startPromise;

    expect(mockQueueManagerInstance.stop).toHaveBeenCalled();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should prevent double start', async () => {
    let resolveSleep: ((value: void | PromiseLike<void>) => void) | undefined;
    const sleepPromise = new Promise<void>((r) => {
      resolveSleep = r;
    });

    mockGetMsUntilTime.mockReturnValue(1000); // Trigger wait
    mockSleep.mockReturnValue(sleepPromise);

    const startPromise = scheduler.start();

    // Wait a tick to ensure start() has proceeded to sleep
    await new Promise((r) => setTimeout(r, 0));

    await expect(scheduler.start()).rejects.toThrow('Scheduler is already running');

    // Stop the scheduler to break the infinite loop of the first start() call
    await scheduler.stop();

    if (resolveSleep) resolveSleep();
    await startPromise;
  });

  it('should wait for queues to drain', async () => {
    // Mock hasActiveProcessing to return true once then false
    mockQueueManagerInstance.hasActiveProcessing.mockReturnValueOnce(true).mockReturnValueOnce(false);

    scheduler = new Scheduler(
      configs,
      downloadManager,
      { mode: 'once' },
      {
        getMsUntilTime: mockGetMsUntilTime,
        getMsUntilCron: mockGetMsUntilCron,
        sleep: mockSleep,
      },
      mockQueueManagerFactory as any,
    );

    await scheduler.start();

    expect(mockQueueManagerInstance.hasActiveProcessing).toHaveBeenCalled();
  });

  it('should handle cron schedules', async () => {
    const cronConfigs = [{ name: 'Cron Series', url: 'http://example.com/cron', cron: '0 0 * * *' }];

    scheduler = new Scheduler(
      cronConfigs as any,
      downloadManager,
      { mode: 'scheduled' },
      {
        getMsUntilTime: mockGetMsUntilTime,
        getMsUntilCron: mockGetMsUntilCron,
        sleep: mockSleep,
      },
      mockQueueManagerFactory as any,
    );

    // Setup:
    // Return 0 first time to schedule immediately
    let firstCall = true;
    mockGetMsUntilCron.mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return 0;
      }
      return 100000;
    });

    const startPromise = scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockGetMsUntilCron).toHaveBeenCalledWith('0 0 * * *');
    expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(1);

    await scheduler.stop();
    await startPromise;
  });

  it('should wait for queue drain and call onIdle when scheduling next batch', async () => {
    const onIdle = mock(() => {});

    // Re-create scheduler with onIdle
    scheduler = new Scheduler(
      configs,
      downloadManager,
      { mode: 'scheduled', onIdle },
      {
        getMsUntilTime: mockGetMsUntilTime,
        getMsUntilCron: mockGetMsUntilCron,
        sleep: mockSleep,
      },
      mockQueueManagerFactory as any,
    );

    // First call: 0ms (immediate)
    // Second call: 60000ms (wait 1 min)
    mockGetMsUntilTime.mockReturnValueOnce(0).mockReturnValue(60000);

    // Queue manager: has active processing (true), then drained (false)
    mockQueueManagerInstance.hasActiveProcessing.mockReturnValueOnce(true).mockReturnValue(false);

    const startPromise = scheduler.start();

    // Wait for execution
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have waited for drain
    expect(mockSleep).toHaveBeenCalled();

    // Should have called onIdle because next wait is > 0
    expect(onIdle).toHaveBeenCalled();

    await scheduler.stop();
    await startPromise;
  });

  it('triggerImmediateChecks should cancel timer, reset queues, and add checks', async () => {
    // Setup: Schedule for 10 seconds in the future
    mockGetMsUntilTime.mockReturnValue(10000);
    mockSleep.mockReturnValue(Promise.resolve());

    const startPromise = scheduler.start();

    // Wait for timer to be set
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify timer was scheduled
    expect(mockGetMsUntilTime).toHaveBeenCalledWith('10:00');

    // Clear previous calls
    mockQueueManagerInstance.addSeriesCheck.mockClear();
    mockQueueManagerInstance.resetQueues.mockClear();

    // Trigger immediate checks (non-blocking)
    scheduler.triggerImmediateChecks();

    // Verify resetQueues was called
    expect(mockQueueManagerInstance.resetQueues).toHaveBeenCalled();

    // Verify checks were added
    expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(3);

    // Method should return immediately (not wait for drain)
    // If it were blocking, this test would hang

    // Cleanup
    await scheduler.stop();
    await startPromise;
  });

  it('triggerImmediateChecks should work when no timer is active', () => {
    // Don't start the scheduler, just call triggerImmediateChecks
    mockQueueManagerInstance.addSeriesCheck.mockClear();
    mockQueueManagerInstance.resetQueues.mockClear();

    // Trigger immediate checks (synchronous, non-blocking)
    scheduler.triggerImmediateChecks();

    // Verify resetQueues was called
    expect(mockQueueManagerInstance.resetQueues).toHaveBeenCalled();

    // Verify checks were added for all configs
    expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(3);

    // Should NOT wait for drain (no hasActiveProcessing call expected)
    // This confirms non-blocking behavior
  });
});
