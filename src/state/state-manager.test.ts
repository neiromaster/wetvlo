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
    stateManager = new StateManager(testStateFile);
  });

  afterEach(() => {
    // Clean up
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
  });

  it('should initialize with empty state if file does not exist', async () => {
    await stateManager.load();
    expect(stateManager.getAllSeriesNames()).toEqual([]);
    expect(stateManager.getDownloadedCount()).toBe(0);
    // Should have created the file
    expect(existsSync(absolutePath)).toBe(true);
  });

  it('should add and track downloaded episodes', async () => {
    await stateManager.load();

    const seriesName = 'Test Series';

    stateManager.addDownloadedEpisode(seriesName, 1);

    expect(stateManager.isDownloaded(seriesName, 1)).toBe(true);
    expect(stateManager.isDownloaded(seriesName, 2)).toBe(false);
    expect(stateManager.getDownloadedCount()).toBe(1);
  });

  it('should persist state to disk', async () => {
    await stateManager.load();

    const seriesName = 'Series 1';
    stateManager.addDownloadedEpisode(seriesName, 1);

    // Explicit save
    await stateManager.save();

    // Create new instance to load from disk
    const newManager = new StateManager(testStateFile);
    await newManager.load();

    expect(newManager.isDownloaded(seriesName, 1)).toBe(true);
  });

  it('should delete series', async () => {
    await stateManager.load();
    const seriesName = 'Series 1';
    stateManager.addDownloadedEpisode(seriesName, 1);
    await stateManager.save();

    expect(stateManager.isDownloaded(seriesName, 1)).toBe(true);

    stateManager.deleteSeries(seriesName);
    expect(stateManager.isDownloaded(seriesName, 1)).toBe(false);
    expect(stateManager.getAllSeriesNames()).toHaveLength(0);
  });

  it('should clear all state', async () => {
    await stateManager.load();
    stateManager.addDownloadedEpisode('Series 1', 1);

    stateManager.clearAll();
    expect(stateManager.getDownloadedCount()).toBe(0);
  });
});
