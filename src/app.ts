import * as readline from 'node:readline';
import { boolean, command, flag, option, string } from 'cmd-ts';
import { AppContext } from './app-context.js';
import { loadConfig } from './config/config-loader.js';
import { ConfigRegistry } from './config/config-registry.js';
import type { SeriesConfig } from './config/config-schema.js';
import { DownloadManager } from './downloader/download-manager.js';
import { ConfigError } from './errors/custom-errors.js';
import { handlerRegistry } from './handlers/handler-registry.js';
import { IQiyiHandler } from './handlers/impl/iqiyi-handler.js';
import { MGTVHandler } from './handlers/impl/mgtv-handler.js';
import { WeTVHandler } from './handlers/impl/wetv-handler.js';
import { ConsoleNotifier } from './notifications/console-notifier.js';
import type { NotificationLevel, Notifier } from './notifications/notifier.js';
import { TelegramNotifier } from './notifications/telegram-notifier.js';
import { Scheduler } from './scheduler/scheduler.js';
import { StateManager } from './state/state-manager.js';
import type { SchedulerMode, SchedulerOptions } from './types/config.types.js';
import { readCookieFile } from './utils/cookie-extractor.js';
import { logger } from './utils/logger.js';

export type AppDependencies = {
  loadConfig: typeof loadConfig;
  checkYtDlpInstalled: () => Promise<boolean>;
  readCookieFile: typeof readCookieFile;
  createDownloadManager: (downloadDir: string, cookieFile?: string, tempDir?: string) => DownloadManager;
  createScheduler: (
    configs: SeriesConfig[],
    downloadManager: DownloadManager,
    cookies?: string,
    options?: SchedulerOptions,
  ) => Scheduler;
};

const defaultDependencies: AppDependencies = {
  loadConfig,
  checkYtDlpInstalled: DownloadManager.checkYtDlpInstalled,
  readCookieFile,
  createDownloadManager: (dir, cf, temp) => new DownloadManager(dir, cf, temp),
  createScheduler: (c, dm, cook, opt) => new Scheduler(c, dm, cook, opt),
};

/**
 * Handle graceful shutdown
 */
export async function handleShutdown(scheduler: Scheduler): Promise<void> {
  logger.info('Shutting down gracefully...');

  try {
    await scheduler.stop();
    logger.success('Shutdown complete');
  } catch (error) {
    logger.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runApp(
  configPath: string,
  mode: SchedulerMode,
  deps: AppDependencies = defaultDependencies,
): Promise<void> {
  logger.info(`Mode: ${mode === 'once' ? 'Single-run (checks once, exits)' : 'Scheduled (waits for startTime)'}`);

  // Check if yt-dlp is installed
  logger.info('Checking yt-dlp installation...');
  const ytDlpInstalled = await deps.checkYtDlpInstalled();

  if (!ytDlpInstalled) {
    throw new Error(
      'yt-dlp is not installed. Please install it first:\n' +
        '  - macOS: brew install yt-dlp\n' +
        '  - Linux: pip install yt-dlp\n' +
        '  - Windows: winget install yt-dlp',
    );
  }

  // Load configuration
  logger.info(`Loading configuration from ${configPath}...`);
  const config = await deps.loadConfig(configPath);
  logger.success('Configuration loaded');

  // Create config registry
  const configRegistry = new ConfigRegistry(config);

  // Set up notifiers using configRegistry
  const notifiers: Array<ConsoleNotifier | TelegramNotifier> = [new ConsoleNotifier()];
  const globalConfig = configRegistry.getConfig('global');

  if (globalConfig.telegram) {
    try {
      notifiers.push(new TelegramNotifier(globalConfig.telegram));
      logger.info('Telegram notifications enabled for errors');
    } catch (error) {
      logger.warning(`Failed to set up Telegram: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Create composite notifier
  const notifier: Notifier = {
    notify: async (level: NotificationLevel, message: string): Promise<void> => {
      await Promise.all(notifiers.map((n) => n.notify(level, message)));
    },
    progress: (message: string): void => {
      for (const n of notifiers) {
        n.progress(message);
      }
    },
    endProgress: (): void => {
      for (const n of notifiers) {
        n.endProgress();
      }
    },
  };

  // Create state manager
  const stateManager = new StateManager(notifier);

  // Initialize AppContext with all services
  AppContext.initialize(configRegistry, notifier, stateManager);
  logger.info('AppContext initialized');

  // Register handlers
  handlerRegistry.register(new WeTVHandler());
  handlerRegistry.register(new IQiyiHandler());
  handlerRegistry.register(new MGTVHandler());
  logger.info(`Registered handlers: ${handlerRegistry.getDomains().join(', ')}`);

  // Load cookies if specified
  let cookies: string | undefined;
  if (globalConfig.cookieFile) {
    try {
      cookies = await deps.readCookieFile(globalConfig.cookieFile);
      logger.success('Cookies loaded from file');
    } catch (error) {
      logger.warning(`Failed to load cookies: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Create download manager
  const downloadDir = globalConfig.download.downloadDir;
  const tempDir = globalConfig.download.tempDir;
  const cookieFile = globalConfig.cookieFile;
  const downloadManager = deps.createDownloadManager(downloadDir, cookieFile, tempDir);

  // Setup interactive mode instructions
  let onIdle: (() => void) | undefined;
  if (mode === 'scheduled' && process.stdin.isTTY) {
    const printInstructions = () => {
      logger.info('Interactive mode enabled:');
      logger.info('  [r] Reload configuration');
      logger.info('  [c] Trigger immediate checks');
      logger.info('  [q] Quit');
    };

    onIdle = printInstructions;
  }

  // Create and start scheduler with queue-based architecture
  logger.info('Using queue-based scheduler');
  const scheduler = deps.createScheduler(config.series, downloadManager, cookies, { mode, onIdle });

  // Set up signal handlers for graceful shutdown
  process.on('SIGINT', async () => {
    await handleShutdown(scheduler);
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await handleShutdown(scheduler);
    process.exit(0);
  });

  // Setup keyboard input listeners
  if (mode === 'scheduled' && process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    process.stdin.on('keypress', async (_str, key) => {
      if (!key) return;

      const name = key.name || '';

      // q, й or Ctrl+C to quit
      if (name === 'q' || name === 'й' || (key.ctrl && name === 'c')) {
        await handleShutdown(scheduler);
        process.exit(0);
      }
      // r or к to reload config
      else if (name === 'r' || name === 'к') {
        try {
          logger.info(`Reloading configuration from ${configPath}...`);
          const newConfig = await deps.loadConfig(configPath);
          const newConfigRegistry = new ConfigRegistry(newConfig);
          AppContext.reloadConfig(newConfigRegistry);
          await scheduler.reload(newConfig.series);
        } catch (error) {
          logger.error(`Failed to reload config: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // c or с (Cyrillic) to trigger checks
      else if (name === 'c' || name === 'с') {
        await scheduler.triggerAllChecks();
      }
    });
  }

  // Start the scheduler
  await scheduler.start();
}

// Define CLI using cmd-ts
export const cli = command({
  name: 'wetvlo',
  description: 'CLI Video Downloader for Chinese streaming sites',
  version: '0.0.1',
  args: {
    config: option({
      type: string,
      long: 'config',
      short: 'c',
      defaultValue: () => './config.yaml',
      description: 'Path to configuration file (default: ./config.yaml)',
    }),
    once: flag({
      type: boolean,
      long: 'once',
      short: 'o',
      description: 'Run in single-run mode (check once and exit)',
    }),
  },
  handler: async ({ config, once }: { config: string; once: boolean }) => {
    try {
      const mode: SchedulerMode = once ? 'once' : 'scheduled';
      await runApp(config, mode);
    } catch (error) {
      if (error instanceof ConfigError) {
        logger.error(`Configuration error: ${error.message}`);
      } else {
        logger.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
      }
      process.exit(1);
    }
  },
});
