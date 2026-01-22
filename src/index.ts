import { loadConfig } from './config/config-loader';
import { DownloadManager } from './downloader/download-manager';
import { ConfigError } from './errors/custom-errors';
import { handlerRegistry } from './handlers/handler-registry';
import { IQiyiHandler } from './handlers/impl/iqiyi-handler';
import { WeTVHandler } from './handlers/impl/wetv-handler';
import { ConsoleNotifier } from './notifications/console-notifier';
import type { NotificationLevel } from './notifications/notifier';
import { TelegramNotifier } from './notifications/telegram-notifier';
import { Scheduler } from './scheduler/scheduler';
import { StateManager } from './state/state-manager';
import { readCookieFile } from './utils/cookie-extractor';
import { logger } from './utils/logger';

/**
 * wetvlo - CLI Video Downloader for Chinese streaming sites
 */

// Set up global error handlers
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

// Handle graceful shutdown
async function handleShutdown(scheduler: Scheduler, stateManager: StateManager): Promise<void> {
  logger.info('Shutting down gracefully...');

  try {
    await scheduler.stop();
    await stateManager.save();
    logger.success('Shutdown complete');
  } catch (error) {
    logger.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
  }

  process.exit(0);
}

async function main(): Promise<void> {
  try {
    // Parse command line args
    const args = process.argv.slice(2);
    const configPath = args[0] || './config.yaml';

    // Check if yt-dlp is installed
    logger.info('Checking yt-dlp installation...');
    const ytDlpInstalled = await DownloadManager.checkYtDlpInstalled();

    if (!ytDlpInstalled) {
      logger.error(
        'yt-dlp is not installed. Please install it first:\n' +
          '  - macOS: brew install yt-dlp\n' +
          '  - Linux: pip install yt-dlp\n' +
          '  - Windows: winget install yt-dlp',
      );
      process.exit(1);
    }

    // Load configuration
    logger.info(`Loading configuration from ${configPath}...`);
    const config = await loadConfig(configPath);
    logger.success('Configuration loaded');

    // Initialize state manager
    const stateManager = new StateManager(config.stateFile);
    await stateManager.load();
    logger.info(`State loaded: ${stateManager.getDownloadedCount()} downloaded episodes`);

    // Set up notifiers
    const notifiers: Array<ConsoleNotifier | TelegramNotifier> = [new ConsoleNotifier()];

    if (config.telegram) {
      try {
        notifiers.push(new TelegramNotifier(config.telegram));
        logger.info('Telegram notifications enabled for errors');
      } catch (error) {
        logger.warning(`Failed to set up Telegram: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Create composite notifier
    const notifier = {
      notify: async (level: NotificationLevel, message: string): Promise<void> => {
        for (const n of notifiers) {
          await n.notify(level, message);
        }
      },
    };

    // Register handlers
    handlerRegistry.register(new WeTVHandler());
    handlerRegistry.register(new IQiyiHandler());
    logger.info(`Registered handlers: ${handlerRegistry.getDomains().join(', ')}`);

    // Load cookies if specified
    let cookies: string | undefined;
    if (config.cookieFile) {
      try {
        cookies = await readCookieFile(config.cookieFile);
        logger.success('Cookies loaded from file');
      } catch (error) {
        logger.warning(`Failed to load cookies: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Create download manager
    const downloadManager = new DownloadManager(stateManager, notifier, config.downloadDir, config.cookieFile);

    // Create and start scheduler
    const scheduler = new Scheduler(
      config.series,
      (url) => handlerRegistry.getHandlerOrThrow(url),
      stateManager,
      downloadManager,
      notifier,
      cookies,
    );

    // Set up signal handlers for graceful shutdown
    process.on('SIGINT', () => handleShutdown(scheduler, stateManager));
    process.on('SIGTERM', () => handleShutdown(scheduler, stateManager));

    // Start the scheduler
    await scheduler.start();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(`Configuration error: ${error.message}`);
    } else {
      logger.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}

// Run the application
main();
