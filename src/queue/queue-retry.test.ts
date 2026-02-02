import { afterEach, describe, expect, it, mock } from 'bun:test';
import { AppContext } from '../app-context';
import { ConfigRegistry } from '../config/config-registry';
import type { DomainConfig } from '../config/config-schema';
import { DownloadManager } from '../downloader/download-manager';
import type { Notifier } from '../notifications/notifier';
import { StateManager } from '../state/state-manager';
import type { Episode, EpisodeType } from '../types/episode.types';

// Mock handler registry BEFORE importing QueueManager
mock.module('../handlers/handler-registry', () => ({
  handlerRegistry: {
    getHandlerOrThrow: mock(() => ({
      extractEpisodes: mock(async () => []),
      extractSeriesInfo: mock(async () => ({ name: 'Test' })),
    })),
  },
}));

import { QueueManager } from './queue-manager';

describe('QueueManager Retry Logic', () => {
  let queueManager: QueueManager;

  // Clean up after tests
  afterEach(() => {
    AppContext.reset();
  });

  it('should block queue processing during retry delay', async () => {
    // Setup
    const domain = 'test.com';
    const downloadDelay = 0.1; // 100ms
    const retryDelay = 0.5; // 500ms (longer than downloadDelay)

    const mockConfig: DomainConfig = {
      stateFile: 'test-state.json',
      domain,
      check: { count: 1 },
      download: {
        downloadDelay,
        maxRetries: 3,
        initialTimeout: retryDelay,
        backoffMultiplier: 1, // Constant delay for test
        jitterPercentage: 0,
      },
    };

    // Mocks
    const stateManager = new StateManager();
    const notifier: Notifier = {
      notify: mock(() => {}),
      progress: mock(() => {}),
      endProgress: mock(() => {}),
    };

    // Initialize AppContext with proper Config structure
    const mockRootConfig = {
      series: [
        {
          name: 'Test Series',
          url: 'http://test.com/series',
          startTime: '20:00',
        },
      ],
      domainConfigs: [mockConfig],
      stateFile: 'test-state.json',
      browser: 'chrome' as const,
    };
    const configRegistry = new ConfigRegistry(mockRootConfig as any);
    AppContext.initialize(configRegistry, notifier, stateManager);

    const downloadManager = new DownloadManager();

    // Mock download behavior
    let attempt = 0;
    const downloadSequence: string[] = [];

    downloadManager.download = mock(async (_url: string, ep: Episode) => {
      const timestamp = Date.now();
      downloadSequence.push(`Start Ep${ep.number} at ${timestamp}`);

      if (ep.number === 1) {
        attempt++;
        if (attempt === 1) {
          throw new Error('Simulated small file error');
        }
      }
      return true;
    });

    // Initialize QueueManager with our config
    queueManager = new QueueManager(downloadManager, undefined);

    // Add episodes
    const episodes: Episode[] = [
      { number: 1, url: 'http://test.com/1', type: 'vip' as EpisodeType, title: 'Ep 1', extractedAt: new Date() },
      { number: 2, url: 'http://test.com/2', type: 'vip' as EpisodeType, title: 'Ep 2', extractedAt: new Date() },
    ];

    queueManager.addEpisodes('http://test.com/series', 'Test Series', episodes);

    // Wait for processing (approx 2 seconds to be safe)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Analyze sequence
    // Expected:
    // 1. Ep 1 Start (Fail)
    // 2. Wait 0.5s (Retry Delay) - Ep 2 should NOT start here
    // 3. Ep 1 Start (Retry, Success)
    // 4. Wait 0.1s (Download Delay)
    // 5. Ep 2 Start

    console.log('Download Sequence:', downloadSequence);

    expect(downloadSequence.length).toBe(3);

    // Parse timestamps
    const times = downloadSequence.map((s) => {
      const match = s.match(/at (\d+)/);
      return match?.[1] ? parseInt(match[1], 10) : 0;
    });

    // Time between attempt 1 (fail) and attempt 2 (retry) should be >= retryDelay (500ms)
    // We check if retry happened at least 0.4s later to account for slight timing variances
    if (times[0] && times[1]) {
      expect(times[1] - times[0]).toBeGreaterThanOrEqual(retryDelay * 1000 - 100);
    }

    // Ep 2 should start AFTER Ep 1 retry
    if (times[1] && times[2]) {
      expect(times[2]).toBeGreaterThan(times[1]);
    }
  });
});
