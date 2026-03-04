# Modules Reference

Complete description of all modules with files, functions, and responsibilities.

---

## 📁 Directory Structure

```
src/
├── index.ts              # Entry point
├── app.ts                # Application orchestration
├── app-context.ts        # Service locator
├── app.test.ts           # App tests
│
├── scheduler/            # Time-based scheduling
│   ├── scheduler.ts
│   ├── scheduler.test.ts
│   └── scheduler-regression.test.ts
│
├── queue/                # Queue management
│   ├── queue-manager.ts
│   ├── universal-scheduler.ts
│   └── typed-queue.ts
│
├── config/               # Configuration
│   ├── config-schema.ts
│   ├── config-schema.test.ts
│   ├── config-loader.ts
│   ├── config-loader.test.ts
│   ├── config-registry.ts
│   ├── config-registry.test.ts
│   └── config-defaults.ts
│
├── handlers/             # Episode extractors
│   ├── base/
│   │   └── base-handler.ts
│   ├── impl/
│   │   ├── wetv-handler.ts
│   │   ├── wetv-handler.test.ts
│   │   ├── iqiyi-handler.ts
│   │   ├── iqiyi-handler.test.ts
│   │   ├── mgtv-handler.ts
│   │   └── mgtv-handler.test.ts
│   └── handler-registry.ts
│
├── downloader/           # Download management
│   ├── download-manager.ts
│   ├── download-manager.test.ts
│   ├── download-options.ts
│   ├── downloader-registry.ts
│   ├── base-downloader.ts
│   ├── types.ts
│   └── impl/
│       ├── yt-dlp-downloader.ts
│       └── lib/
│           ├── ytdlp-wrapper.ts
│           ├── ytdlp-presets.ts
│           └── index.ts
│
├── state/                # State persistence
│   ├── state-manager.ts
│   └── state-manager.test.ts
│
├── notifications/        # Notifications
│   ├── notifier.ts
│   ├── notification-level.ts
│   ├── console-notifier.ts
│   ├── telegram-notifier.ts
│   └── composite-notifier.ts
│
├── types/                # TypeScript types
│   ├── episode.types.ts
│   ├── config.types.ts
│   ├── state.types.ts
│   ├── handler.types.ts
│   └── episode-type.ts
│
├── errors/               # Custom errors
│   └── custom-errors.ts
│
└── utils/                # Utilities
    ├── time-utils.ts
    ├── time-utils.test.ts
    ├── url-utils.ts
    ├── url-utils.test.ts
    ├── filename-sanitizer.ts
    ├── filename-sanitizer.test.ts
    ├── video-validator.ts
    ├── video-validator.test.ts
    ├── env-resolver.ts
    ├── env-resolver.test.ts
    ├── cookie-extractor.ts
    ├── cookie-extractor.test.ts
    ├── cookie-sync.ts
    ├── deep-merge.ts
    ├── logger.ts
    ├── logger.test.ts
    └── create-enum.ts
```

---

## 🚀 Entry Point

### `src/index.ts`

**Responsibility:** CLI entry point

```typescript
export async function main(args: string[] = process.argv.slice(2)): Promise<void>
```

**Dependencies:** cmd-ts

**Flow:**
```
main()
  └─ run(cli)
      └─ app.ts:runApp()
```

---

## 🎯 Application Layer

### `src/app.ts`

**Responsibility:** Orchestration of all components

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `runApp()` | Main: initialization, start scheduler |
| `handleShutdown()` | Graceful shutdown (SIGINT/SIGTERM) |
| `printInstructions()` | Interactive mode: [r], [c], [q] hints |

**Dependency Injection:**
```typescript
type AppDependencies = {
  loadConfig: typeof loadConfig,
  checkYtDlpInstalled: () => Promise<boolean>,
  createDownloadManager: () => DownloadManager,
  createScheduler: typeof Scheduler
};
```

**Flow:**
```
runApp()
  ├─ loadConfig()
  ├─ new ConfigRegistry()
  ├─ new CompositeNotifier()
  ├─ AppContext.initialize()
  ├─ handlerRegistry.register()
  ├─ new DownloadManager()
  ├─ new Scheduler()
  ├─ scheduler.start()
  └─ await forever (for scheduled mode)
```

---

### `src/app-context.ts`

**Responsibility:** Global service locator (Singleton)

**Class:** `AppContext`

**Methods:**

| Method | Purpose |
|--------|---------|
| `initialize()` | Initialize with services |
| `getConfig()` | Get ConfigRegistry |
| `getNotifier()` | Get Notifier |
| `getStateManager()` | Get StateManager |
| `reloadConfig()` | Reload config |
| `setNotifier()` | Update notifier |
| `isInitialized()` | Check initialization |
| `reset()` | Reset (for tests) |

**Usage:**
```typescript
AppContext.getConfig().resolve(url, 'series');
AppContext.getNotifier().notify(NotificationLevel.INFO, 'message');
AppContext.getStateManager().isDownloaded(path, name, number);
```

---

## ⏰ Scheduler Layer

### `src/scheduler/scheduler.ts`

**Responsibility:** Managing launch times (cron/startTime)

**Class:** `Scheduler`

**Methods:**

| Method | Purpose |
|--------|---------|
| `constructor()` | Creates QueueManager with executor callback |
| `start()` | Start scheduler |
| `stop()` | Stop scheduler |
| `reload()` | Reload config |
| `scheduleNextBatch()` | Calculate time until next batch |
| `groupConfigsBySchedule()` | Group by startTime/cron |
| `runConfigs()` | Add series to QueueManager |
| `runOnce()` | Single check (mode: 'once') |
| `triggerAllChecks()` | Immediate trigger of all checks |
| `updateDownloadManager()` | Update DownloadManager |
| `clearQueues()` | Clear queues |
| `getQueueManager()` | Get QueueManager (for tests) |
| `isRunning()` | Check running status |

**Types:**
```typescript
type TimeProvider = {
  getMsUntilTime(time: string): number;
  getMsUntilCron(cron: string): number;
};

type QueueManagerFactory = (downloadManager: DownloadManager) => QueueManager;
```

---

## 📦 Queue Layer

### `src/queue/queue-manager.ts`

**Responsibility:** Queue management, retry, backoff

**Class:** `QueueManager`

**Methods:**

| Method | Purpose |
|--------|---------|
| `constructor()` | Creates UniversalScheduler with executor callback |
| `start()` | Start all queues |
| `stop()` | Stop all queues |
| `addSeriesCheck()` | Create check queue for series |
| `addEpisodes()` | Add episodes to download queue |
| `executeTask()` | Executor callback for UniversalScheduler |
| `executeCheck()` | Execute check task |
| `executeDownload()` | Execute download task |
| `performCheck()` | Extract episodes via handler |
| `calculateBackoff()` | Exponential backoff with jitter |
| `updateConfig()` | Update config |
| `clearQueues()` | Clear queues |
| `resetQueues()` | Reset to initial state |
| `hasActiveProcessing()` | Check activity |
| `getQueueStats()` | Queue statistics |
| `registerDownloadQueue()` | Register download queue |
| `registerSeriesCheckQueue()` | Register check queue |

**Private Methods:**
```typescript
private registerDownloadQueue(domain: string): void
private registerSeriesCheckQueue(domain: string, seriesUrl: string): string
private executeTask(task, queueName): Promise<void>
private executeCheck(item, domain, queueName): Promise<void>
private executeDownload(item, domain, queueName): Promise<void>
private performCheck(handler, seriesUrl, config, attemptNumber, domain): Promise<...>
private calculateBackoff(retryCount, initialTimeout, backoffMultiplier, jitterPercentage): number
```

---

### `src/queue/universal-scheduler.ts`

**Responsibility:** Global executor (1 task at a time)

**Class:** `UniversalScheduler<TaskType>`

**Methods:**

| Method | Purpose |
|--------|---------|
| `constructor()` | Creates executor callback |
| `start()` | Start scheduler |
| `stop()` | Stop scheduler |
| `resume()` | Resume |
| `registerQueue()` | Register queue with cooldown |
| `unregisterQueue()` | Remove queue |
| `hasQueue()` | Check queue existence |
| `clearQueues()` | Clear all queues |
| `resetQueues()` | Reset to initial state |
| `addTask()` | Add task to queue |
| `addPriorityTask()` | Add to queue front |
| `markTaskComplete()` | Mark task complete |
| `markTaskFailed()` | Mark task failed |
| `scheduleNext()` | Trigger next task |
| `setOnWait()` | Set wait callback |
| `getStats()` | Queue statistics |
| `isExecutorBusy()` | Check executor busy |
| `hasPendingTasks()` | Check for tasks |
| `getTotalPendingTasks()` | Total task count |

**Private Methods:**
```typescript
private trySchedule(): boolean
private executeTask(queueName, task): Promise<void>
private scheduleTimer(waitMs, queueName, nextTime): void
private clearTimer(): void
private getEarliestAvailableTime(): {time, queueName} | null
```

---

### `src/queue/typed-queue.ts`

**Responsibility:** FIFO queue with delays and cooldown

**Class:** `TypedQueue<TaskType>`

**Methods:**

| Method | Purpose |
|--------|---------|
| `add()` | Add task with delay |
| `addPriority()` | Add to queue front |
| `getNext()` | Get next task |
| `hasTasks()` | Check for tasks |
| `canStart()` | Check ready to execute |
| `markStarted()` | Mark execution started |
| `clear()` | Clear queue |
| `reset()` | Reset to initial state |
| `getLength()` | Queue length |
| `getNextAvailableTime()` | Next task time |

---

## 🌐 Handlers Layer

### `src/handlers/base/base-handler.ts`

**Responsibility:** Base class for all handlers

**Functions:**

| Function | Purpose |
|----------|---------|
| `supports()` | Check URL support |
| `getDomain()` | Abstract: return domain |
| `extractEpisodes()` | Abstract: extract episodes |
| `fetchHtml()` | Load HTML with cookies |
| `parseHtml()` | Parse HTML via Cheerio |
| `parseEpisodeNumber()` | Extract episode number |
| `parseEpisodeType()` | Determine episode type |

**Protected Methods (used in subclass):**
```typescript
protected async fetchHtml(url: string, cookies?: string): Promise<string>
protected parseHtml(html: string): cheerio.CheerioAPI
protected parseEpisodeNumber(text: string): number | null
protected parseEpisodeType(element, $): EpisodeType
```

---

### `src/handlers/impl/wetv-handler.ts`

**Responsibility:** Extractor for wetv.vip

**Class:** `WeTVHandler extends BaseHandler`

**Methods:**
```typescript
getDomain(): string  // "wetv.vip"
async extractEpisodes(url: string): Promise<Episode[]>
```

---

### `src/handlers/impl/iqiyi-handler.ts`

**Responsibility:** Extractor for iq.com

**Class:** `IQiyiHandler extends BaseHandler`

**Methods:**
```typescript
getDomain(): string  // "iq.com"
async extractEpisodes(url: string): Promise<Episode[]>
```

---

### `src/handlers/impl/mgtv-handler.ts`

**Responsibility:** Extractor for mgtv.com

**Class:** `MGTVHandler extends BaseHandler`

**Methods:**
```typescript
getDomain(): string  // "mgtv.com"
async extractEpisodes(url: string): Promise<Episode[]>
```

---

### `src/handlers/handler-registry.ts`

**Responsibility:** Handler registration and retrieval

**Exports:**
```typescript
export const handlerRegistry = {
  register(handler: DomainHandler): void
  getHandler(url: string): DomainHandler | undefined
  getHandlerOrThrow(url: string): DomainHandler
  getDomains(): string[]
  hasHandler(url: string): boolean
};
```

---

## 📥 Downloader Layer

### `src/downloader/download-manager.ts`

**Responsibility:** Download orchestration via yt-dlp

**Class:** `DownloadManager`

**Methods:**

| Method | Purpose |
|--------|---------|
| `download()` | Download episode |
| `checkYtDlpInstalled()` | Check yt-dlp presence |
| `cleanupEpisodeArtifacts()` | Delete .part files |
| `verifyDownload()` | Verify file size |
| `formatSize()` | Format size |

**Private Methods:**
```typescript
private async cleanupFiles(files): Promise<void>
private async cleanupEpisodeArtifacts(dir, filenameWithoutExt): Promise<void>
private verifyDownload(filename): number
private formatSize(bytes): string
```

---

### `src/downloader/impl/yt-dlp-downloader.ts`

**Responsibility:** yt-dlp wrapper

**Class:** `YtDlpDownloader`

**Methods:**
```typescript
async download(episode, targetDir, filenameWithoutExt, options): Promise<{
  filename: string,
  allFiles: string[]
}>
```

---

### `src/downloader/downloader-registry.ts`

**Responsibility:** Downloader registration and retrieval

**Exports:**
```typescript
export const downloaderRegistry = {
  getDownloader(url: string): Downloader
};
```

---

## 💾 State Layer

### `src/state/state-manager.ts`

**Responsibility:** JSON persistence with mutex

**Class:** `StateManager`

**Methods:**

| Method | Purpose |
|--------|---------|
| `isDownloaded()` | Check if episode downloaded |
| `addDownloadedEpisode()` | Add episode to state |
| `getSeriesEpisodes()` | Get all series episodes |

**Private Methods:**
```typescript
private async withLock(statePath, fn): Promise<T>  // Mutex
private loadState(statePath): State
private async saveState(statePath, state): Promise<void>
private resolvePath(statePath): string
private handleError(error, message): void
```

---

## ⚙️ Config Layer

### `src/config/config-registry.ts`

**Responsibility:** 4-level configuration merge

**Class:** `ConfigRegistry`

**Methods:**

| Method | Purpose |
|--------|---------|
| `resolve()` | Get config for URL and level |
| `listSeries()` | List all series |
| `getDomain()` | Extract domain from URL |

**Resolution levels:**
```typescript
resolve(url, 'global')   // Global settings
resolve(url, 'domain')   // Domain settings
resolve(url, 'series')   // Series settings (highest priority)
```

---

### `src/config/config-loader.ts`

**Responsibility:** YAML loading

**Functions:**
```typescript
async function loadConfig(configPath: string): Promise<RawConfig>
```

---

### `src/config/config-schema.ts`

**Responsibility:** Zod validation schemas

**Exports:**
```typescript
export const ConfigSchema = z.object({...});
export type SeriesConfigResolved = z.infer<typeof SeriesConfigSchema>;
export type ResolvedConfig<Level> = z.infer<...>;
```

---

### `src/config/config-defaults.ts`

**Responsibility:** Default values

**Exports:**
```typescript
export const DEFAULTS = {
  check: {
    count: 3,
    interval: 600,
    ...
  },
  download: {
    maxRetries: 2,
    initialTimeout: 60,
    ...
  }
};
```

---

## 🔔 Notifications Layer

### `src/notifications/notifier.ts`

**Responsibility:** Notifier interface

**Type:**
```typescript
type Notifier = {
  notify(level: NotificationLevel, message: string): void
  progress(message: string): void
  endProgress(): void
};
```

---

### `src/notifications/composite-notifier.ts`

**Responsibility:** Composite of multiple notifiers

**Class:** `CompositeNotifier`

**Methods:**
```typescript
add(notifier: Notifier, priority: number): void
notify(level, message): void  // Sends to all with priority
progress(message): void
endProgress(): void
```

---

### `src/notifications/console-notifier.ts`

**Responsibility:** Console output

**Class:** `ConsoleNotifier`

---

### `src/notifications/telegram-notifier.ts`

**Responsibility:** Telegram sending

**Class:** `TelegramNotifier`

---

### `src/notifications/notification-level.ts`

**Responsibility:** Notification levels

**Exports:**
```typescript
enum NotificationLevel {
  DEBUG = 0,
  INFO = 1,
  SUCCESS = 2,
  HIGHLIGHT = 3,
  WARNING = 4,
  ERROR = 5
}
```

---

## 🔧 Utilities Layer

### `src/utils/time-utils.ts`

**Functions:**

| Function | Purpose |
|----------|---------|
| `getMsUntilTime()` | Milliseconds until HH:MM |
| `getMsUntilCron()` | Milliseconds until cron |
| `sleep()` | Async delay |
| `parseTime()` | Parse HH:MM |

---

### `src/utils/url-utils.ts`

**Functions:**

| Function | Purpose |
|----------|---------|
| `extractDomain()` | Extract domain from URL |
| `isValidUrl()` | Validate URL |

---

### `src/utils/filename-sanitizer.ts`

**Functions:**

| Function | Purpose |
|----------|---------|
| `sanitizeFilename()` | Clean filename |

---

### `src/utils/video-validator.ts`

**Functions:**

| Function | Purpose |
|----------|---------|
| `getVideoDuration()` | Get video duration |
| `getVideoSize()` | Get file size |

---

### `src/utils/deep-merge.ts`

**Functions:**

| Function | Purpose |
|----------|---------|
| `deepMerge()` | Recursive object merge |
| `type DeepMerge` | Type for merged result |

---

### `src/utils/cookie-sync.ts`

**Class:** `CookieRefreshManager`

**Responsibility:** Cookie refresh via Playwright

---

## 📝 Types Layer

### `src/types/episode.types.ts`

**Types:**
```typescript
type Episode = {
  number: number
  url: string
  type: EpisodeType
  title?: string
}
```

---

### `src/types/config.types.ts`

**Types:**
```typescript
type SchedulerMode = 'once' | 'scheduled'
type SchedulerOptions = {...}
```

---

### `src/types/state.types.ts`

**Types:**
```typescript
type State = {...}
type EpisodeNumber = string  // "01", "02"
```

---

### `src/types/handler.types.ts`

**Types:**
```typescript
type DomainHandler = {
  getDomain(): string
  supports(url): boolean
  extractEpisodes(url): Promise<Episode[]>
}
```

---

### `src/types/episode-type.ts`

**Types:**
```typescript
type EpisodeType = 'episode' | 'pv' | 'extra' | 'opening' | 'ending'
```

---

## ❌ Errors Layer

### `src/errors/custom-errors.ts`

**Classes:**

| Class | Extends | Purpose |
|-------|---------|---------|
| `WetvloError` | Error | Base error |
| `ConfigError` | WetvloError | Config error |
| `SchedulerError` | WetvloError | Scheduler error |
| `HandlerError` | WetvloError | Handler error |
| `DownloadError` | WetvloError | Download error |

---

## 📚 Final Dependency Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    index.ts                             │
│                        ↓                                │
│                    app.ts                               │
│         ┌────────────────────────────────┐              │
│         │     AppContext (singleton)     │              │
│         ├────────────────────────────────┤              │
│         │ • ConfigRegistry               │              │
│         │ • Notifier                     │              │
│         │ • StateManager                 │              │
│         └────────────────────────────────┘              │
│                    ↓                                    │
│              Scheduler                                  │
│                    ↓                                    │
│            QueueManager                                 │
│                    ↓                                    │
│        UniversalScheduler                               │
│                    ↓                                    │
│         ┌──────────┴──────────┐                         │
│         ↓                     ↓                         │
│    Handlers              DownloadManager                │
│         │                     │                         │
│         ↓                     ↓                         │
│    StateManager ◄─────────────┘                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🧪 Tests

**Location:** `**/*.test.ts`

**Run:**
```bash
bun test                    # All tests
bun test <path>             # Specific file
```

**Coverage:**
- Unit tests for each component
- Regression tests (`scheduler-regression.test.ts`)
- Total: **272 tests**

---

For more details see:
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Architecture layers and patterns
- [EXECUTION_FLOW.md](./EXECUTION_FLOW.md) — Detailed execution flow
