import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NotificationLevel } from '../notifications/notifier.js';
import { Scheduler } from './scheduler.js';

// Define mutable mocks
const mockGetMsUntilTime = mock(() => 0);
const mockSleep = mock(() => Promise.resolve());

// Mock dependencies
const mockQueueManagerInstance = {
  start: mock(() => {}),
  stop: mock(() => Promise.resolve()),
  addSeriesCheck: mock(() => {}),
  getQueueStats: mock(() => ({})),
  hasActiveProcessing: mock(() => false),
};

// Factory mock
const mockQueueManagerFactory = mock(() => mockQueueManagerInstance);

describe('Scheduler', () => {
  let scheduler: Scheduler;
  let stateManager: any;
  let downloadManager: any;
  let notifier: any;

  const configs = [
    { name: 'Series 1', url: 'http://example.com/1', startTime: '10:00' },
    { name: 'Series 2', url: 'http://example.com/2', startTime: '10:00' },
    { name: 'Series 3', url: 'http://example.com/3', startTime: '10:00' },
  ];

  beforeEach(() => {
    // Reset mocks defaults
    mockGetMsUntilTime.mockReturnValue(0);
    mockSleep.mockReturnValue(Promise.resolve());

    stateManager = {
      save: mock(() => Promise.resolve()),
    };
    downloadManager = {};
    notifier = {
      notify: mock(() => {}),
    };

    // Reset queue manager mocks
    mockQueueManagerInstance.start.mockClear();
    mockQueueManagerInstance.stop.mockClear();
    mockQueueManagerInstance.addSeriesCheck.mockClear();
    mockQueueManagerInstance.hasActiveProcessing.mockClear();
    mockQueueManagerInstance.hasActiveProcessing.mockReturnValue(false);
    mockQueueManagerFactory.mockClear();

    // Create scheduler
    scheduler = new Scheduler(
      configs,
      stateManager,
      downloadManager,
      notifier,
      undefined,
      { mode: 'scheduled' },
      undefined,
      undefined,
      {
        getMsUntilTime: mockGetMsUntilTime,
        sleep: mockSleep,
      },
      mockQueueManagerFactory as any,
    );
  });

  it('should initialize queue manager', () => {
    expect(scheduler.getQueueManager()).toBeDefined();
  });

  it('should start scheduler in scheduled mode', async () => {
    // Setup to break the infinite loop:
    // 1. No wait for start time
    mockGetMsUntilTime.mockReturnValue(0);
    // 2. Simulate active processing to enter the drain loop
    mockQueueManagerInstance.hasActiveProcessing.mockReturnValue(true);
    // 3. Stop scheduler when sleeping in the drain loop
    mockSleep.mockImplementation(async () => {
      await scheduler.stop();
    });

    await scheduler.start();

    expect(mockQueueManagerInstance.start).toHaveBeenCalled();
    expect(notifier.notify).toHaveBeenCalledWith(NotificationLevel.INFO, expect.stringContaining('Scheduler started'));

    // Should add all configs to queue
    expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(3);
  });

  it('should start scheduler in once mode', async () => {
    scheduler = new Scheduler(
      configs,
      stateManager,
      downloadManager,
      notifier,
      undefined,
      { mode: 'once' },
      undefined,
      undefined,
      {
        getMsUntilTime: mockGetMsUntilTime,
        sleep: mockSleep,
      },
      mockQueueManagerFactory as any,
    );

    await scheduler.start();

    expect(mockQueueManagerInstance.start).toHaveBeenCalled();
    expect(notifier.notify).toHaveBeenCalledWith(NotificationLevel.INFO, expect.stringContaining('Single-run mode'));

    expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(3);
    expect(stateManager.save).toHaveBeenCalled();
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
    expect(stateManager.save).toHaveBeenCalled();
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
      stateManager,
      downloadManager,
      notifier,
      undefined,
      { mode: 'once' },
      undefined,
      undefined,
      {
        getMsUntilTime: mockGetMsUntilTime,
        sleep: mockSleep,
      },
      mockQueueManagerFactory as any,
    );

    await scheduler.start();

    expect(mockQueueManagerInstance.hasActiveProcessing).toHaveBeenCalled();
  });
});
