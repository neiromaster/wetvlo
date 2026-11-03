/**
 * Base error class for wetvlo
 */
export class WetvloError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WetvloError';
  }
}

/**
 * Configuration error
 */
export class ConfigError extends WetvloError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * State file error
 */
export class StateError extends WetvloError {
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
  }
}

/**
 * Handler error (episode extraction issues)
 */
export class HandlerError extends WetvloError {
  constructor(
    message: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = 'HandlerError';
  }
}

/**
 * Download error
 */
export class DownloadError extends WetvloError {
  constructor(
    message: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

/**
 * Trial/preview content was served instead of the full episode — typically a
 * stale or missing session. The queue manager treats this like CookieError:
 * a Firefox-tab session rescue is worth a try before retrying.
 */
export class TrialContentError extends WetvloError {
  constructor(
    message: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = 'TrialContentError';
  }
}

/**
 * Notification error
 */
export class NotificationError extends WetvloError {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationError';
  }
}

/**
 * Cookie extraction error
 */
export class CookieError extends WetvloError {
  constructor(message: string) {
    super(message);
    this.name = 'CookieError';
  }
}

/**
 * Scheduling error
 */
export class SchedulerError extends WetvloError {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulerError';
  }
}
