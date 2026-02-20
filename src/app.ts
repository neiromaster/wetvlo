import * as readline from 'node:readline';
import { boolean, command, flag, option, string } from 'cmd-ts';
import { AppContext } from './app-context';
import { loadConfig } from './config/config-loader';
import { ConfigRegistry } from './config/config-registry';
import type { SeriesConfigResolved } from './config/config-schema';
import { DownloadManager } from './downloader/download-manager';
import { ConfigError } from './errors/custom-errors';
import { handlerRegistry } from './handlers/handler-registry';
import { IQiyiHandler } from './handlers/impl/iqiyi-handler';
import { MGTVHandler } from './handlers/impl/mgtv-handler';
import { WeTVHandler } from './handlers/impl/wetv-handler';
import { CompositeNotifier } from './notifications/composite-notifier';
import { ConsoleNotifier } from './notifications/console-notifier';
import { NotificationLevel } from './notifications/notification-level';
import type { Notifier } from './notifications/notifier';
import { TelegramNotifier } from './notifications/telegram-notifier';
import { Scheduler } from './scheduler/scheduler';
import type { SchedulerMode, SchedulerOptions } from './types/config.types';
import { readCookieFile } from './utils/cookie-extractor';
import { CookieRefreshManager } from './utils/cookie-sync';

export type AppDependencies = {
  loadConfig: typeof loadConfig;
  checkYtDlpInstalled: () => Promise<boolean>;
  readCookieFile: typeof readCookieFile;
  createDownloadManager: () => DownloadManager;
  createScheduler: (
    configs: SeriesConfigResolved[],
    downloadManager: DownloadManager,
    options?: SchedulerOptions,
  ) => Scheduler;
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
export async function handleShutdown(scheduler: Scheduler, notifier: Notifier): Promise<void> {
  notifier.notify(NotificationLevel.DEBUG, 'Shutting down gracefully...');

  try {
    const cookieManager = CookieRefreshManager.getInstance();
    await cookieManager.shutdown();

    await scheduler.stop();
    notifier.notify(NotificationLevel.DEBUG, 'Shutdown complete');
  } catch (error) {
    notifier.notify(
      NotificationLevel.ERROR,
      `Error during shutdown: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function runApp(
  configPath: string,
  mode: SchedulerMode,
  deps: AppDependencies = defaultDependencies,
  debug: boolean = false,
): Promise<void> {
  const config = await deps.loadConfig(configPath);

  const configRegistry = new ConfigRegistry(config);

  // Create composite notifier and add built-in notifiers
  const notifier = new CompositeNotifier();
  const cfg = configRegistry.resolve('', 'global');

  const consoleNotifier = new ConsoleNotifier(debug ? NotificationLevel.DEBUG : cfg.notifications.consoleMinLevel);
  notifier.add(consoleNotifier, 0);
  if (cfg.telegram?.botToken && cfg.telegram?.chatId) {
    try {
      notifier.add(new TelegramNotifier(cfg.telegram), 10);
    } catch (error) {
      notifier.notify(
        NotificationLevel.WARNING,
        `Failed to set up Telegram: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  notifier.notify(NotificationLevel.INFO, `Mode: ${mode}`);

  // Initialize AppContext with all services
  AppContext.initialize(configRegistry, notifier);
  notifier.notify(NotificationLevel.DEBUG, 'AppContext initialized');

  // Check if yt-dlp is installed
  notifier.notify(NotificationLevel.DEBUG, 'Checking yt-dlp installation...');
  const ytDlpInstalled = await deps.checkYtDlpInstalled();

  if (!ytDlpInstalled) {
    throw new Error(
      'yt-dlp is not installed. Please install it first:\n' +
        '  - macOS: brew install yt-dlp\n' +
        '  - Linux: pip install yt-dlp\n' +
        '  - Windows: winget install yt-dlp',
    );
  }

  notifier.notify(NotificationLevel.DEBUG, 'Configuration loaded');

  // Register handlers
  handlerRegistry.register(new WeTVHandler());
  handlerRegistry.register(new IQiyiHandler());
  handlerRegistry.register(new MGTVHandler());
  notifier.notify(NotificationLevel.DEBUG, `Registered handlers: ${handlerRegistry.getDomains().join(', ')}`);

  // Create download manager
  const downloadManager = deps.createDownloadManager();

  // Setup interactive mode instructions
  let onIdle: (() => void) | undefined;
  if (mode === 'scheduled' && process.stdin.isTTY) {
    const printInstructions = () => {
      const ctxNotifier = AppContext.getNotifier();
      ctxNotifier.notify(NotificationLevel.INFO, 'Interactive mode enabled:');
      ctxNotifier.notify(NotificationLevel.INFO, '  [r] Reload configuration');
      ctxNotifier.notify(NotificationLevel.INFO, '  [c] Clear queues and trigger checks');
      ctxNotifier.notify(NotificationLevel.INFO, '  [q] Quit');
    };

    onIdle = printInstructions;
  }

  // Create and start scheduler with queue-based architecture
  notifier.notify(NotificationLevel.DEBUG, 'Using queue-based scheduler');
  const scheduler = deps.createScheduler(configRegistry.listSeries(), downloadManager, { mode, onIdle });

  // Set up signal handlers for graceful shutdown
  const onShutdown = async () => {
    const ctxNotifier = AppContext.getNotifier();
    await handleShutdown(scheduler, ctxNotifier);
    process.exit(0);
  };
  process.on('SIGINT', onShutdown);
  process.on('SIGTERM', onShutdown);

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
        const ctxNotifier = AppContext.getNotifier();
        await handleShutdown(scheduler, ctxNotifier);
        process.exit(0);
      }
      // r or к to reload config
      else if (name === 'r' || name === 'к' || char === 'к') {
        const ctxNotifier = AppContext.getNotifier();
        try {
          ctxNotifier.notify(NotificationLevel.DEBUG, `Reloading configuration from ${configPath}...`);
          const newConfig = await deps.loadConfig(configPath);
          const newConfigRegistry = new ConfigRegistry(newConfig);

          // Create new composite notifier with built-in notifiers
          const newNotifier = new CompositeNotifier();
          const newCfg = newConfigRegistry.resolve('', 'global');
          const newConsoleNotifier = new ConsoleNotifier(
            debug ? NotificationLevel.DEBUG : newCfg.notifications.consoleMinLevel,
          );
          newNotifier.add(newConsoleNotifier, 0);
          if (newCfg.telegram?.botToken && newCfg.telegram?.chatId) {
            try {
              newNotifier.add(new TelegramNotifier(newCfg.telegram), 10);
            } catch (error) {
              newNotifier.notify(
                NotificationLevel.WARNING,
                `Failed to set up Telegram: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          AppContext.setNotifier(newNotifier);

          // Reload config registry and scheduler
          AppContext.reloadConfig(newConfigRegistry);
          await scheduler.reload(newConfigRegistry.listSeries());

          // Reinitialize cookie refresh browser to apply new config
          const cookieManager = CookieRefreshManager.getInstance();
          await cookieManager.reinitialize();

          newNotifier.notify(NotificationLevel.SUCCESS, 'Configuration reloaded successfully');
        } catch (error) {
          ctxNotifier.notify(
            NotificationLevel.ERROR,
            `Failed to reload config: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // c or с (Cyrillic) to trigger immediate checks
      else if (name === 'c' || name === 'с' || char === 'с') {
        scheduler.triggerImmediateChecks();
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
        console.error(`Configuration error: ${error.message}`);
      } else {
        console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
      }
      process.exit(1);
    }
  },
});
