import { describe, expect, it } from 'bun:test';
import {
  ConfigError,
  CookieError,
  DownloadError,
  HandlerError,
  NotificationError,
  SchedulerError,
  StateError,
  WetvloError,
} from './custom-errors.js';

describe('Custom Errors', () => {
  it('WetvloError should store message and have correct name', () => {
    const error = new WetvloError('test message');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WetvloError);
    expect(error.message).toBe('test message');
    expect(error.name).toBe('WetvloError');
  });

  it('ConfigError should inherit from WetvloError', () => {
    const error = new ConfigError('config error');
    expect(error).toBeInstanceOf(WetvloError);
    expect(error.name).toBe('ConfigError');
  });

  it('StateError should inherit from WetvloError', () => {
    const error = new StateError('state error');
    expect(error).toBeInstanceOf(WetvloError);
    expect(error.name).toBe('StateError');
  });

  it('HandlerError should have url property', () => {
    const url = 'http://example.com';
    const error = new HandlerError('handler error', url);
    expect(error).toBeInstanceOf(WetvloError);
    expect(error.name).toBe('HandlerError');
    expect(error.url).toBe(url);
    expect(error.message).toBe('handler error');
  });

  it('DownloadError should have url property', () => {
    const url = 'http://example.com';
    const error = new DownloadError('download error', url);
    expect(error).toBeInstanceOf(WetvloError);
    expect(error.name).toBe('DownloadError');
    expect(error.url).toBe(url);
    expect(error.message).toBe('download error');
  });

  it('NotificationError should inherit from WetvloError', () => {
    const error = new NotificationError('notification error');
    expect(error).toBeInstanceOf(WetvloError);
    expect(error.name).toBe('NotificationError');
  });

  it('CookieError should inherit from WetvloError', () => {
    const error = new CookieError('cookie error');
    expect(error).toBeInstanceOf(WetvloError);
    expect(error.name).toBe('CookieError');
  });

  it('SchedulerError should inherit from WetvloError', () => {
    const error = new SchedulerError('scheduler error');
    expect(error).toBeInstanceOf(WetvloError);
    expect(error.name).toBe('SchedulerError');
  });
});
