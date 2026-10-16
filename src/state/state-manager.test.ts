import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { StateManager } from './state-manager.js';

describe('StateManager', () => {
  const testStateFile = `state-test-${Date.now()}.json`;
  const absolutePath = join(process.cwd(), testStateFile);
  let stateManager: StateManager;

  beforeEach(() => {
    // Clean up if exists
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
    stateManager = new StateManager();
  });

  afterEach(() => {
    // Clean up
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
  });

  it('should initialize with empty state if file does not exist', () => {
    const episodes = stateManager.getSeriesEpisodes(testStateFile, 'Test Series');
    expect(episodes).toEqual([]);
    // Should NOT create the file until we write to it
    expect(existsSync(absolutePath)).toBe(false);
  });

  it('should add and track downloaded episodes', async () => {
    const seriesName = 'Test Series';

    await stateManager.addDownloadedEpisode(testStateFile, seriesName, 1);

    expect(stateManager.isDownloaded(testStateFile, seriesName, 1)).toBe(true);
    expect(stateManager.isDownloaded(testStateFile, seriesName, 2)).toBe(false);

    const episodes = stateManager.getSeriesEpisodes(testStateFile, seriesName);
    expect(episodes).toEqual(['01']);
    // Should have created the file
    expect(existsSync(absolutePath)).toBe(true);
  });

  it('should persist state to disk', async () => {
    const seriesName = 'Series 1';
    await stateManager.addDownloadedEpisode(testStateFile, seriesName, 1);

    // Create new instance to load from disk
    const newManager = new StateManager();
    expect(newManager.isDownloaded(testStateFile, seriesName, 1)).toBe(true);
  });

  it('should handle multiple episodes', async () => {
    const seriesName = 'Series 1';
    await stateManager.addDownloadedEpisode(testStateFile, seriesName, 5);
    await stateManager.addDownloadedEpisode(testStateFile, seriesName, 3);
    await stateManager.addDownloadedEpisode(testStateFile, seriesName, 1);

    const episodes = stateManager.getSeriesEpisodes(testStateFile, seriesName);
    // Episodes should be sorted
    expect(episodes).toEqual(['01', '03', '05']);
  });

  it('should not duplicate episodes', async () => {
    const seriesName = 'Series 1';
    await stateManager.addDownloadedEpisode(testStateFile, seriesName, 1);
    await stateManager.addDownloadedEpisode(testStateFile, seriesName, 1);

    const episodes = stateManager.getSeriesEpisodes(testStateFile, seriesName);
    expect(episodes).toEqual(['01']);
  });

  it('should handle concurrent writes without data loss', async () => {
    const seriesName = 'Concurrent Series';

    // Fire 3 addDownloadedEpisode calls simultaneously
    await Promise.all([
      stateManager.addDownloadedEpisode(testStateFile, seriesName, 1),
      stateManager.addDownloadedEpisode(testStateFile, seriesName, 2),
      stateManager.addDownloadedEpisode(testStateFile, seriesName, 3),
    ]);

    const episodes = stateManager.getSeriesEpisodes(testStateFile, seriesName);
    expect(episodes).toEqual(['01', '02', '03']);
  });

  it('should handle multiple series', async () => {
    await stateManager.addDownloadedEpisode(testStateFile, 'Series 1', 1);
    await stateManager.addDownloadedEpisode(testStateFile, 'Series 2', 2);

    expect(stateManager.isDownloaded(testStateFile, 'Series 1', 1)).toBe(true);
    expect(stateManager.isDownloaded(testStateFile, 'Series 2', 2)).toBe(true);
    expect(stateManager.isDownloaded(testStateFile, 'Series 1', 2)).toBe(false);
  });

  describe('subs-only marker', () => {
    it('should mark an episode as subs-only and report it', async () => {
      const seriesName = 'TVOD Series';

      await stateManager.addSubsOnlyEpisode(testStateFile, seriesName, 9);

      expect(stateManager.isSubsOnly(testStateFile, seriesName, 9)).toBe(true);
      expect(stateManager.getSeriesEpisodes(testStateFile, seriesName)).toEqual(['09:subs']);
    });

    it('should keep subs-only episodes not-downloaded so they are retried', async () => {
      const seriesName = 'TVOD Series';

      await stateManager.addSubsOnlyEpisode(testStateFile, seriesName, 9);

      expect(stateManager.isDownloaded(testStateFile, seriesName, 9)).toBe(false);
    });

    it('should not duplicate subs-only markers', async () => {
      const seriesName = 'TVOD Series';

      await stateManager.addSubsOnlyEpisode(testStateFile, seriesName, 9);
      await stateManager.addSubsOnlyEpisode(testStateFile, seriesName, 9);

      expect(stateManager.getSeriesEpisodes(testStateFile, seriesName)).toEqual(['09:subs']);
    });

    it('should not mark subs-only when the episode is already fully downloaded', async () => {
      const seriesName = 'TVOD Series';

      await stateManager.addDownloadedEpisode(testStateFile, seriesName, 9);
      await stateManager.addSubsOnlyEpisode(testStateFile, seriesName, 9);

      expect(stateManager.getSeriesEpisodes(testStateFile, seriesName)).toEqual(['09']);
      expect(stateManager.isSubsOnly(testStateFile, seriesName, 9)).toBe(false);
    });

    it('should sort subs-only markers alongside plain numbers', async () => {
      const seriesName = 'TVOD Series';

      await stateManager.addDownloadedEpisode(testStateFile, seriesName, 3);
      await stateManager.addSubsOnlyEpisode(testStateFile, seriesName, 9);
      await stateManager.addDownloadedEpisode(testStateFile, seriesName, 1);

      expect(stateManager.getSeriesEpisodes(testStateFile, seriesName)).toEqual(['01', '03', '09:subs']);
    });

    it('should upgrade a subs-only marker to a full download', async () => {
      const seriesName = 'TVOD Series';

      await stateManager.addSubsOnlyEpisode(testStateFile, seriesName, 9);
      await stateManager.addDownloadedEpisode(testStateFile, seriesName, 9);

      expect(stateManager.getSeriesEpisodes(testStateFile, seriesName)).toEqual(['09']);
      expect(stateManager.isDownloaded(testStateFile, seriesName, 9)).toBe(true);
      expect(stateManager.isSubsOnly(testStateFile, seriesName, 9)).toBe(false);
    });

    it('should report isSubsOnly false for unknown episodes', () => {
      expect(stateManager.isSubsOnly(testStateFile, 'Nope', 1)).toBe(false);
    });
  });
});
