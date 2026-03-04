/**
 * Regression tests for the "blocking batch scheduling" bug
 *
 * Bug: When multiple series were scheduled at the same time, only one domain/series
 * would be processed because waitForQueueDrain() blocked scheduleNextBatch() from running.
 *
 * Fix: Removed waitForQueueDrain() blocking to allow immediate scheduling.
 *
 * These tests use SAFE mode='once' to avoid infinite loops with old code.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { AppContext } from '../app-context';
import type { EpisodeType } from '../types/episode-type';
import { Scheduler } from './scheduler';

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

const mockQueueManagerFactory = mock(() => mockQueueManagerInstance);

describe('Scheduler Regression Tests - Multi-Domain Scheduling', () => {
  let scheduler: Scheduler;
  let notifier: any;

  const multiDomainConfigs = [
    {
      domain: 'wetv.vip',
      name: 'WeTV Series',
      url: 'https://wetv.vip/play/abc',
      startTime: '13:00',
      check: {
        count: 3,
        checkInterval: 60000,
        downloadTypes: ['available', 'vip'] as EpisodeType[],
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
      domain: 'iq.com',
      name: 'IQ Series',
      url: 'https://iq.com/play/xyz',
      startTime: '13:00', // SAME time as WeTV
      check: {
        count: 3,
        checkInterval: 60000,
        downloadTypes: ['available', 'vip'] as EpisodeType[],
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
      domain: 'mgtv.com',
      name: 'MGTV Series',
      url: 'https://mgtv.com/play/def',
      startTime: '13:00', // SAME time as others
      check: {
        count: 3,
        checkInterval: 60000,
        downloadTypes: ['available'] as EpisodeType[],
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
    notifier = {
      notify: mock(() => {}),
      progress: mock(() => {}),
      endProgress: mock(() => {}),
    };

    mockQueueManagerInstance.start.mockClear();
    mockQueueManagerInstance.stop.mockClear();
    mockQueueManagerInstance.addSeriesCheck.mockClear();
    mockQueueManagerInstance.hasActiveProcessing.mockClear();
    mockQueueManagerInstance.hasActiveProcessing.mockReturnValue(false);
    mockQueueManagerFactory.mockClear();

    AppContext.reset();
    const mockConfigRegistry = {
      resolve: mock(() => ({})),
      getConfig: mock(() => ({})),
    } as any;
    AppContext.initialize(mockConfigRegistry, notifier as any);
  });

  afterEach(() => {
    AppContext.reset();
  });

  describe('Bug: Different schedule times', () => {
    it('should execute series at different scheduled times', async () => {
      const differentTimes = [
        {
          domain: 'example.com',
          name: 'Morning Series',
          url: 'http://example.com/morning',
          startTime: '09:00',
          check: {
            count: 1,
            checkInterval: 60000,
            downloadTypes: ['available'] as EpisodeType[],
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
          name: 'Evening Series',
          url: 'http://example.com/evening',
          startTime: '21:00',
          check: {
            count: 1,
            checkInterval: 60000,
            downloadTypes: ['available'] as EpisodeType[],
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

      const mockGetMsUntilTime = mock(() => 0);

      scheduler = new Scheduler(
        differentTimes,
        {} as any,
        { mode: 'once' },
        {
          getMsUntilTime: mockGetMsUntilTime,
          getMsUntilCron: mock(() => 0),
          sleep: mock(() => Promise.resolve()),
        },
        mockQueueManagerFactory as any,
      );

      await scheduler.start();

      // Both schedules should execute
      expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(2);

      // Verify each URL was checked
      expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledWith('http://example.com/morning');
      expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledWith('http://example.com/evening');
    });
  });

  describe('Line 153 Bug Detection', () => {
    it('DETECTS BUG: scheduled mode with immediate time calls hasActiveProcessing from scheduleNextBatch', async () => {
      // CRITICAL TEST - This test FAILS with the bug, PASSES with the fix
      //
      // Line 153 contains: `await this.waitForQueueDrain()`
      // This line should be REMOVED to fix the bug
      //
      // Detection strategy:
      // - Use scheduled mode with immediate time (0ms)
      // - Track when hasActiveProcessing is called
      // - With bug: hasActiveProcessing called AFTER runConfigs (in scheduleNextBatch)
      // - With fix: hasActiveProcessing NOT called (no waitForQueueDrain in scheduleNextBatch)

      const callLog: string[] = [];
      let addSeriesCheckCount = 0;

      mockQueueManagerInstance.hasActiveProcessing.mockImplementation(() => {
        callLog.push(`hasActiveProcessing-call-${mockQueueManagerInstance.hasActiveProcessing.mock.calls.length}`);
        return false; // Queue is empty
      });

      mockQueueManagerInstance.addSeriesCheck.mockImplementation(() => {
        addSeriesCheckCount++;
        callLog.push(`addSeriesCheck-${addSeriesCheckCount}`);
      });

      let timeCallCount = 0;
      const mockGetMsUntilTime = mock(() => {
        timeCallCount++;
        callLog.push(`getMsUntilTime-${timeCallCount}`);
        // First batch is immediate
        return timeCallCount === 1 ? 0 : 999999;
      });

      scheduler = new Scheduler(
        multiDomainConfigs,
        {} as any,
        { mode: 'scheduled' }, // CRITICAL: scheduled mode, not once!
        {
          getMsUntilTime: mockGetMsUntilTime,
          getMsUntilCron: mock(() => 999999),
          sleep: mock(() => Promise.resolve()),
        },
        mockQueueManagerFactory as any,
      );

      const startPromise = scheduler.start();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify all configs were added
      expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(3);

      // Check the call log to detect the bug
      const hasActiveProcessingCalls = mockQueueManagerInstance.hasActiveProcessing.mock.calls.length;

      // With BUG (line 153 present): hasActiveProcessing called (waitForQueueDrain executes)
      // With FIX (line 153 removed): hasActiveProcessing NOT called (no waitForQueueDrain)
      //
      // SO EXPECTATION: hasActiveProcessing should NOT be called in scheduled mode
      // when queue is empty and we're using scheduleNextBatch
      expect(hasActiveProcessingCalls).toBe(0);

      await scheduler.stop();
      await startPromise;
    });

    it('VERIFIES FIX: Multiple series with same time all get scheduled', async () => {
      // This test verifies that the fix allows all series to be scheduled
      // even when they have the same start time

      mockQueueManagerInstance.hasActiveProcessing.mockReturnValue(false);
      mockQueueManagerInstance.hasActiveProcessing.mockClear();

      let timeCallCount = 0;
      const mockGetMsUntilTime = mock(() => {
        timeCallCount++;
        // Only first batch is immediate
        return timeCallCount === 1 ? 0 : 999999;
      });

      scheduler = new Scheduler(
        multiDomainConfigs,
        {} as any,
        { mode: 'scheduled' },
        {
          getMsUntilTime: mockGetMsUntilTime,
          getMsUntilCron: mock(() => 999999),
          sleep: mock(() => Promise.resolve()),
        },
        mockQueueManagerFactory as any,
      );

      const startPromise = scheduler.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // All three should be added
      expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(3);

      // Verify specific URLs
      expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledWith('https://wetv.vip/play/abc');
      expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledWith('https://iq.com/play/xyz');
      expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledWith('https://mgtv.com/play/def');

      await scheduler.stop();
      await startPromise;
    });

    it('should handle large number of series', async () => {
      const manyConfigs = Array.from({ length: 10 }, (_, i) => ({
        domain: 'example.com',
        name: `Series ${i}`,
        url: `http://example.com/${i}`,
        startTime: '13:00',
        check: {
          count: 1,
          checkInterval: 60000,
          downloadTypes: ['available'] as EpisodeType[],
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
      }));

      const mockGetMsUntilTime = mock(() => 0);

      scheduler = new Scheduler(
        manyConfigs,
        {} as any,
        { mode: 'once' },
        {
          getMsUntilTime: mockGetMsUntilTime,
          getMsUntilCron: mock(() => 0),
          sleep: mock(() => Promise.resolve()),
        },
        mockQueueManagerFactory as any,
      );

      await scheduler.start();

      // All 10 configs should be checked
      expect(mockQueueManagerInstance.addSeriesCheck).toHaveBeenCalledTimes(10);

      // Verify all unique URLs were checked
      // @ts-expect-error - mock.calls type inference issue in test
      const checkedUrls = new Set(mockQueueManagerInstance.addSeriesCheck.mock.calls.map((call) => call[0]));
      expect(checkedUrls.size).toBe(10);
    });
  });
});
