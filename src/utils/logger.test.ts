import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Logger, LogLevel } from './logger.js';

describe('Logger', () => {
  let logger: Logger;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    logger = new Logger({ useColors: false });
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should log info messages', () => {
    logger.info('info message');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ℹ️ info message'));
  });

  it('should log error messages', () => {
    logger.error('error message');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ error message'));
  });

  it('should filter messages based on level', () => {
    logger.setLevel(LogLevel.WARNING);

    logger.debug('debug');
    logger.info('info');
    logger.success('success');
    logger.warning('warning');
    logger.error('error');

    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('debug'));
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('info'));
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('success'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('warning'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('error'));
  });

  it('should use colors when enabled', () => {
    logger = new Logger({ useColors: true });
    logger.info('message');
    // Check for ANSI codes
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('\x1b['));
  });

  it('should disable colors when disabled', () => {
    logger = new Logger({ useColors: false });
    logger.info('message');
    // Check for absence of ANSI codes (simple check)
    // The previous test verified format includes [INFO] message
    // If we want to be strict, we can check that it doesn't contain escape codes
    const lastCall = (console.log as any).mock.lastCall[0];
    expect(lastCall).not.toContain('\x1b[');
  });
});
