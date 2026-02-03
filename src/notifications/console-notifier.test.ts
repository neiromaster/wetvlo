import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { logger } from '../utils/logger';
import { ConsoleNotifier } from './console-notifier';
import { NotificationLevel } from './notifier';

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

  it('should call logger.info for INFO level', () => {
    notifier.notify(NotificationLevel.INFO, 'test message');
    expect(logger.info).toHaveBeenCalledWith('test message');
  });

  it('should call logger.success for SUCCESS level', () => {
    notifier.notify(NotificationLevel.SUCCESS, 'test message');
    expect(logger.success).toHaveBeenCalledWith('test message');
  });

  it('should call logger.warning for WARNING level', () => {
    notifier.notify(NotificationLevel.WARNING, 'test message');
    expect(logger.warning).toHaveBeenCalledWith('test message');
  });

  it('should call logger.error for ERROR level', () => {
    notifier.notify(NotificationLevel.ERROR, 'test message');
    expect(logger.error).toHaveBeenCalledWith('test message');
  });

  it('should call logger.highlight for HIGHLIGHT level', () => {
    notifier.notify(NotificationLevel.HIGHLIGHT, 'test message');
    expect(logger.highlight).toHaveBeenCalledWith('test message');
  });

  it('should write progress to stdout', () => {
    notifier.progress('progress message');
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('progress message'));
  });

  it('should clear previous progress line', () => {
    notifier.progress('first');
    notifier.progress('second');

    // Should verify it writes \r and spaces
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('\r'));
  });

  it('should finalize progress with newline', () => {
    notifier.progress('progress');
    notifier.endProgress();
    expect(process.stdout.write).toHaveBeenCalledWith('\n');
  });

  it('should not finalize progress if no progress was active', () => {
    notifier.endProgress();
    // Should NOT print newline if nothing was written
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it('should clear progress before notifying', () => {
    notifier.progress('progress...');
    // Clear the spy to focus on notify calls
    stdoutWriteSpy.mockClear();

    notifier.notify(NotificationLevel.INFO, 'new message');

    // Should have cleared the line: \r + spaces + \r
    // We expect it to be called with a string that starts with \r and contains spaces
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringMatching(/^\r +\r$/));
    // And logged the message
    expect(logger.info).toHaveBeenCalledWith('new message');
  });
});
