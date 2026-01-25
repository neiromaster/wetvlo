/**
 * Log level
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  HIGHLIGHT = 'HIGHLIGHT',
}

/**
 * Logger configuration
 */
export type LoggerConfig = {
  level: LogLevel;
  useColors: boolean;
};

/**
 * ANSI color codes
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

/**
 * Logger class with colored console output
 */
export class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? LogLevel.INFO,
      useColors: config.useColors ?? true,
    };
  }

  /**
   * Get emoji for log level
   */
  private getEmoji(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return '🔍';
      case LogLevel.INFO:
        return 'ℹ️';
      case LogLevel.SUCCESS:
        return '✅';
      case LogLevel.WARNING:
        return '⚠️';
      case LogLevel.ERROR:
        return '❌';
      case LogLevel.HIGHLIGHT:
        return '🌟';
      default:
        return '•';
    }
  }

  /**
   * Format date to human readable string (MM-DD HH:mm:ss)
   */
  private formatDate(date: Date): string {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    const sec = date.getSeconds().toString().padStart(2, '0');
    return `${month}-${day} ${hour}:${min}:${sec}`;
  }

  /**
   * Format log message with timestamp and level
   */
  private format(level: LogLevel, message: string): string {
    const timestamp = this.formatDate(new Date());
    const emoji = this.getEmoji(level);
    return `${timestamp} ${emoji} ${message}`;
  }

  /**
   * Apply color to text
   */
  private colorize(text: string, color: string): string {
    if (!this.config.useColors) return text;
    return `${color}${text}${colors.reset}`;
  }

  /**
   * Log debug message
   */
  debug(message: string): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.format(LogLevel.DEBUG, this.colorize(message, colors.dim)));
    }
  }

  /**
   * Log info message
   */
  info(message: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.format(LogLevel.INFO, this.colorize(message, colors.blue)));
    }
  }

  /**
   * Log success message
   */
  success(message: string): void {
    if (this.shouldLog(LogLevel.SUCCESS)) {
      console.log(this.format(LogLevel.SUCCESS, this.colorize(message, colors.green)));
    }
  }

  /**
   * Log warning message
   */
  warning(message: string): void {
    if (this.shouldLog(LogLevel.WARNING)) {
      console.log(this.format(LogLevel.WARNING, this.colorize(message, colors.yellow)));
    }
  }

  /**
   * Log error message
   */
  error(message: string): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.format(LogLevel.ERROR, this.colorize(message, colors.red)));
    }
  }

  /**
   * Log highlighted message
   */
  highlight(message: string): void {
    if (this.shouldLog(LogLevel.HIGHLIGHT)) {
      console.log(this.format(LogLevel.HIGHLIGHT, this.colorize(message, colors.bright + colors.magenta)));
    }
  }

  /**
   * Check if message should be logged based on level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.SUCCESS,
      LogLevel.WARNING,
      LogLevel.ERROR,
      LogLevel.HIGHLIGHT,
    ];
    return levels.indexOf(level) >= levels.indexOf(this.config.level);
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }
}

// Default logger instance
export const logger: Logger = new Logger();
