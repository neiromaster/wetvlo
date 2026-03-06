import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { logger } from '../utils/logger';
import { ConsoleNotifier } from './console-notifier';
import { NotificationLevel } from './notification-level';

// Mock logger
mock.module('../utils/logger.js', () => ({
  logger: {
    info: mock(() => {}),
    success: mock(() => {}),
    warning: mock(() => {}),
    error: mock(() => {}),
    highlight: mock(() => {}),
    debug: mock(() => {}),
  },
}));

describe('ConsoleNotifier', () => {
  let notifier: ConsoleNotifier;
  let stdoutWriteSpy: any;

  beforeEach(() => {
    notifier = new ConsoleNotifier();
    stdoutWriteSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
    stdoutWriteSpy.mockClear();

    // Reset logger mocks
    (logger.info as any).mockClear();
    (logger.success as any).mockClear();
    (logger.warning as any).mockClear();
    (logger.error as any).mockClear();
    (logger.highlight as any).mockClear();
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  // Helper to wait for queued operations
  async function waitForQueue() {
    // Wait for setImmediate to process the queue
    await new Promise((resolve) => setImmediate(resolve));
    // Wait a bit more for any nested operations
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it('should call logger.info for INFO level', async () => {
    await notifier.notify(NotificationLevel.INFO, 'test message');
    await waitForQueue();
    expect(logger.info).toHaveBeenCalledWith('test message');
  });

  it('should call logger.success for SUCCESS level', async () => {
    await notifier.notify(NotificationLevel.SUCCESS, 'test message');
    await waitForQueue();
    expect(logger.success).toHaveBeenCalledWith('test message');
  });

  it('should call logger.warning for WARNING level', async () => {
    await notifier.notify(NotificationLevel.WARNING, 'test message');
    await waitForQueue();
    expect(logger.warning).toHaveBeenCalledWith('test message');
  });

  it('should call logger.error for ERROR level', async () => {
    await notifier.notify(NotificationLevel.ERROR, 'test message');
    await waitForQueue();
    expect(logger.error).toHaveBeenCalledWith('test message');
  });

  it('should call logger.highlight for HIGHLIGHT level', async () => {
    await notifier.notify(NotificationLevel.HIGHLIGHT, 'test message');
    await waitForQueue();
    expect(logger.highlight).toHaveBeenCalledWith('test message');
  });

  it('should write progress to stdout', async () => {
    notifier.progress('progress message');
    await waitForQueue();
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('progress message'));
  });

  it('should clear previous progress line', async () => {
    notifier.progress('first');
    await waitForQueue();
    stdoutWriteSpy.mockClear();

    notifier.progress('second');
    await waitForQueue();

    // Should verify it writes \r and spaces
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('\r'));
  });

  it('should finalize progress with newline', async () => {
    notifier.progress('progress');
    await waitForQueue();
    stdoutWriteSpy.mockClear();

    notifier.endProgress();
    await waitForQueue();

    expect(process.stdout.write).toHaveBeenCalledWith('\n');
  });

  it('should not finalize progress if no progress was active', async () => {
    notifier.endProgress();
    await waitForQueue();
    // Should NOT print newline if nothing was written
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it('should clear progress before notifying', async () => {
    notifier.progress('progress...');
    await waitForQueue();
    // Clear the spy to focus on notify calls
    stdoutWriteSpy.mockClear();

    await notifier.notify(NotificationLevel.INFO, 'new message');
    await waitForQueue();

    // Should have cleared the line: \r + spaces + \r
    // We expect it to be called with a string that starts with \r and contains spaces
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringMatching(/^\r +\r$/));
    // And logged the message
    expect(logger.info).toHaveBeenCalledWith('new message');
  });

  it('should not notify below minimum level', async () => {
    const debugNotifier = new ConsoleNotifier(NotificationLevel.WARNING);
    await debugNotifier.notify(NotificationLevel.INFO, 'test message');
    await waitForQueue();
    // INFO is below WARNING, so logger.info should not be called
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should handle multiple notifications in order', async () => {
    await notifier.notify(NotificationLevel.INFO, 'first');
    await notifier.notify(NotificationLevel.SUCCESS, 'second');
    await notifier.notify(NotificationLevel.WARNING, 'third');
    await waitForQueue();

    expect(logger.info).toHaveBeenCalledWith('first');
    expect(logger.success).toHaveBeenCalledWith('second');
    expect(logger.warning).toHaveBeenCalledWith('third');
  });
});
