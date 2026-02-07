import * as readline from 'node:readline';
import { boolean, command, flag, option, string } from 'cmd-ts';
import { AppContext } from './app-context';
import { loadConfig } from './config/config-loader';
import { ConfigRegistry } from './config/config-registry';
import type { SeriesConfig } from './config/config-schema';
import { DownloadManager } from './downloader/download-manager';
import { ConfigError } from './errors/custom-errors';
import { handlerRegistry } from './handlers/handler-registry';
import { IQiyiHandler } from './handlers/impl/iqiyi-handler';
import { MGTVHandler } from './handlers/impl/mgtv-handler';
import { WeTVHandler } from './handlers/impl/wetv-handler';
import { ConsoleNotifier } from './notifications/console-notifier';
import type { NotificationLevel, Notifier } from './notifications/notifier';
import { TelegramNotifier } from './notifications/telegram-notifier';
import { Scheduler } from './scheduler/scheduler';
import { StateManager } from './state/state-manager';
import type { SchedulerMode, SchedulerOptions } from './types/config.types';
import { readCookieFile } from './utils/cookie-extractor';
import { LogLevel, logger } from './utils/logger';

export type AppDependencies = {
  loadConfig: typeof loadConfig;
  checkYtDlpInstalled: () => Promise<boolean>;
  readCookieFile: typeof readCookieFile;
  createDownloadManager: () => DownloadManager;
  createScheduler: (configs: SeriesConfig[], downloadManager: DownloadManager, options?: SchedulerOptions) => Scheduler;
};

const defaultDependencies: AppDependencies = {
  loadConfig,
  checkYtDlpInstalled: DownloadManager.checkYtDlpInstalled,
  readCookieFile,
  createDownloadManager: () => new DownloadManager(),
  createScheduler: (c, dm, opt) => new Scheduler(c, dm, opt),
};

/**
 * Handle graceful shutdown
 */
export async function handleShutdown(scheduler: Scheduler): Promise<void> {
  logger.debug('Shutting down gracefully...');

  try {
    await scheduler.stop();
    logger.debug('Shutdown complete');
  } catch (error) {
    logger.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runApp(
  configPath: string,
  mode: SchedulerMode,
  deps: AppDependencies = defaultDependencies,
  debug: boolean = false,
): Promise<void> {
  // Set log level based on debug flag
  const currentLevel = debug ? LogLevel.DEBUG : LogLevel.INFO;
  logger.setLevel(currentLevel);

  logger.info(`Mode: ${mode}`);

  // Check if yt-dlp is installed
  logger.debug('Checking yt-dlp installation...');
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
  logger.debug(`Loading configuration from ${configPath}...`);
  const config = await deps.loadConfig(configPath);
  logger.debug('Configuration loaded');

  // Create config registry
  const configRegistry = new ConfigRegistry(config);

  // Get global config (stored in let for config reload comparison)
  let _globalConfig = configRegistry.getConfig('global');

  /**
   * Create notifier instance from config
   * Extracted to factory function for reuse during config reload
   */
  const createNotifier = (registry: ConfigRegistry): Notifier => {
    const notifiers: Array<ConsoleNotifier | TelegramNotifier> = [new ConsoleNotifier()];
    const cfg = registry.getConfig('global');

    if (cfg.telegram) {
      try {
        notifiers.push(new TelegramNotifier(cfg.telegram));
        logger.debug('Telegram notifications enabled for errors');
      } catch (error) {
        logger.warning(`Failed to set up Telegram: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Create composite notifier
    return {
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
  };

  const notifier = createNotifier(configRegistry);

  // Create state manager
  const stateManager = new StateManager(notifier);

  // Initialize AppContext with all services
  AppContext.initialize(configRegistry, notifier, stateManager);
  logger.debug('AppContext initialized');

  // Register handlers
  handlerRegistry.register(new WeTVHandler());
  handlerRegistry.register(new IQiyiHandler());
  handlerRegistry.register(new MGTVHandler());
  logger.debug(`Registered handlers: ${handlerRegistry.getDomains().join(', ')}`);

  // Create download manager
  const downloadManager = deps.createDownloadManager();

  // Setup interactive mode instructions
  let onIdle: (() => void) | undefined;
  if (mode === 'scheduled' && process.stdin.isTTY) {
    const printInstructions = () => {
      logger.info('Interactive mode enabled:');
      logger.info('  [r] Reload configuration');
      logger.info('  [c] Clear queues and trigger checks');
      logger.info('  [q] Quit');
    };

    onIdle = printInstructions;
  }

  // Create and start scheduler with queue-based architecture
  logger.debug('Using queue-based scheduler');
  const scheduler = deps.createScheduler(config.series, downloadManager, { mode, onIdle });

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

    process.stdin.on('keypress', async (str, key) => {
      if (!key) return;

      const name = key.name || '';
      const char = str || '';

      // q, й or Ctrl+C to quit
      if (name === 'q' || name === 'й' || char === 'й' || (key.ctrl && name === 'c')) {
        await handleShutdown(scheduler);
        process.exit(0);
      }
      // r or к to reload config
      else if (name === 'r' || name === 'к' || char === 'к') {
        try {
          logger.debug(`Reloading configuration from ${configPath}...`);
          const newConfig = await deps.loadConfig(configPath);
          const newConfigRegistry = new ConfigRegistry(newConfig);
          const newGlobalConfig = newConfigRegistry.getConfig('global');

          // Reload notifier (Telegram settings, etc.)
          const newNotifier = createNotifier(newConfigRegistry);
          AppContext.setNotifier(newNotifier);

          // Update global config reference
          _globalConfig = newGlobalConfig;

          // Reload config registry and scheduler
          AppContext.reloadConfig(newConfigRegistry);
          await scheduler.reload(newConfig.series);

          logger.success('Configuration reloaded successfully');
        } catch (error) {
          logger.error(`Failed to reload config: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // c or с (Cyrillic) to clear queues and trigger checks
      else if (name === 'c' || name === 'с' || char === 'с') {
        scheduler.clearQueues();
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
    debug: flag({
      type: boolean,
      long: 'debug',
      short: 'd',
      description: 'Enable debug logging',
    }),
  },
  handler: async ({ config, once, debug }: { config: string; once: boolean; debug: boolean }) => {
    try {
      const mode: SchedulerMode = once ? 'once' : 'scheduled';
      await runApp(config, mode, defaultDependencies, debug);
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
