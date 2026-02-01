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

  it('should handle multiple series', async () => {
    await stateManager.addDownloadedEpisode(testStateFile, 'Series 1', 1);
    await stateManager.addDownloadedEpisode(testStateFile, 'Series 2', 2);

    expect(stateManager.isDownloaded(testStateFile, 'Series 1', 1)).toBe(true);
    expect(stateManager.isDownloaded(testStateFile, 'Series 2', 2)).toBe(true);
    expect(stateManager.isDownloaded(testStateFile, 'Series 1', 2)).toBe(false);
  });
});
