# Modules Reference

Complete description of all modules with files, functions, and responsibilities.

---

## 📁 Directory Structure

```
src/
├── index.ts                        # Entry point
├── index.test.ts
├── app.ts                          # Application orchestration
├── app-context.ts                  # Service locator
├── app.test.ts
├── app-interactive.test.ts
│
├── scheduler/                      # Time-based scheduling
│   ├── scheduler.ts
│   ├── scheduler.test.ts
│   └── scheduler-regression.test.ts
│
├── queue/                          # Queue management
│   ├── queue-manager.ts
│   ├── queue-manager.test.ts
│   ├── queue-retry.test.ts
│   ├── universal-scheduler.ts
│   ├── universal-scheduler.test.ts
│   ├── typed-queue.ts
│   ├── typed-queue.test.ts
│   ├── retry-strategy.ts
│   ├── retry-strategy.test.ts
│   └── types.ts
│
├── events/                         # Event-based architecture
│   ├── event-bus.ts
│   ├── event-bus.test.ts
│   └── event-types.ts
│
├── config/                         # Configuration
│   ├── config-schema.ts
│   ├── config-schema.test.ts
│   ├── config-loader.ts
│   ├── config-loader.test.ts
│   ├── config-registry.ts
│   ├── config-registry.test.ts
│   ├── config-registry-windows-paths.test.ts
│   ├── config-defaults.ts
│   ├── config-windows-advanced.test.ts
│   ├── config-windows-integration.test.ts
│   └── config-windows-specific.test.ts
│
├── handlers/                       # Episode extractors
│   ├── base/
│   │   ├── base-handler.ts
│   │   └── base-handler.test.ts
│   ├── impl/
│   │   ├── wetv-handler.ts
│   │   ├── wetv-handler.test.ts
│   │   ├── iqiyi-handler.ts
│   │   ├── iqiyi-handler.test.ts
│   │   ├── mgtv-handler.ts
│   │   ├── mgtv-handler.test.ts
│   │   ├── youku-handler.ts
│   │   └── youku-handler.test.ts
│   ├── handler-registry.ts
│   └── handler-registry.test.ts
│
├── downloader/                     # Download management
│   ├── download-manager.ts
│   ├── download-manager.test.ts
│   ├── download-options.ts
│   ├── downloader-registry.ts
│   ├── base-downloader.ts
│   ├── types.ts
│   ├── impl/
│   │   ├── yt-dlp-downloader.ts
│   │   ├── mgtv-downloader.ts
│   │   ├── mgtv-downloader.test.ts
│   │   ├── youku-downloader.ts
│   │   └── youku-downloader.test.ts
│   └── lib/
│       ├── index.ts
│       ├── ytdlp-wrapper.ts
│       ├── ytdlp-wrapper.test.ts
│       ├── ytdlp-presets.ts
│       ├── mgtv-api.ts
│       ├── mgtv-api.test.ts
│       ├── mgtv-quality.ts
│       ├── mgtv-quality.test.ts
│       ├── mgtv-subs.ts
│       ├── mgtv-subs.test.ts
│       ├── youku-api.ts
│       └── youku-api.test.ts
│
├── state/                          # State persistence
│   ├── state-manager.ts
│   └── state-manager.test.ts
│
├── notifications/                  # Notifications
│   ├── notifier.ts
│   ├── notification-level.ts
│   ├── console-notifier.ts
│   ├── console-notifier.test.ts
│   ├── telegram-notifier.ts
│   ├── telegram-notifier.test.ts
│   ├── composite-notifier.ts
│   ├── composite-notifier.test.ts
│   └── event-notifier.ts
│
├── types/                          # TypeScript types
│   ├── episode.types.ts
│   ├── config.types.ts
│   ├── state.types.ts
│   ├── handler.types.ts
│   └── episode-type.ts
│
├── errors/                         # Custom errors
│   ├── custom-errors.ts
│   └── custom-errors.test.ts
│
├── test-utils/                     # Shared test helpers
│   └── queue-module-restore.ts
│
└── utils/                          # Utilities
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
    ├── firefox-cookies.ts
    ├── firefox-cookies.test.ts
    ├── firefox-rescue.ts
    ├── firefox-rescue.test.ts
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
  createScheduler: (configs, downloadManager, options?, eventBus?) => Scheduler
};
```

**Flow:**
```
runApp()
  ├─ loadConfig()
  ├─ new ConfigRegistry()
  ├─ new CompositeNotifier() (ConsoleNotifier + TelegramNotifier)
  ├─ getEventBus()                       # global EventBus singleton
  ├─ AppContext.initialize(..., eventBus)
  ├─ checkYtDlpInstalled()               # static DownloadManager.checkYtDlpInstalled
  ├─ handlerRegistry.register()          # wetv, iqiyi, mgtv, youku
  ├─ downloaderRegistry.register()       # youku custom downloader (mgtv → yt-dlp native)
  ├─ new DownloadManager()
  ├─ new Scheduler(..., eventBus)
  └─ scheduler.start()
```

---

### `src/app-context.ts`

**Responsibility:** Global service locator (Singleton)

**Class:** `AppContext`

**Methods:**

| Method | Purpose |
|--------|---------|
| `initialize()` | Initialize with services (config, notifier, stateManager?, eventBus?) |
| `getConfig()` | Get ConfigRegistry |
| `getNotifier()` | Get Notifier |
| `getStateManager()` | Get StateManager |
| `getEventBus()` | Get EventBus |
| `reloadConfig()` | Reload config |
| `setNotifier()` | Update notifier |
| `isInitialized()` | Check initialization |
| `reset()` | Reset (for tests) |

**Usage:**
```typescript
AppContext.getConfig().resolve(url, 'series');
AppContext.getNotifier().notify(NotificationLevel.INFO, 'message');
AppContext.getStateManager().isDownloaded(path, name, number);
AppContext.getEventBus().on('queue:task:start', (e) => { ... });
```

---

## ⏰ Scheduler Layer

### `src/scheduler/scheduler.ts`

**Responsibility:** Managing launch times (cron/startTime)

**Class:** `Scheduler`

**Methods:**

| Method | Purpose |
|--------|---------|
| `constructor()` | Creates QueueManager (with executor callback and EventBus) |
| `start()` | Start scheduler |
| `stop()` | Stop scheduler |
| `reload()` | Reload config |
| `scheduleNextBatch()` | Calculate time until next batch |
| `groupConfigsBySchedule()` | Group by startTime/cron |
| `triggerAllChecks()` | Immediate trigger of all checks |
| `triggerImmediateChecks()` | Clear queues + trigger checks (interactive `[c]`) |
| `runConfigs()` | Add series to QueueManager (private, called by scheduleNextBatch) |
| `runOnce()` | Single check (mode: 'once', private) |
| `updateDownloadManager()` | Update DownloadManager |
| `clearQueues()` | Clear queues |
| `getQueueManager()` | Get QueueManager (for tests) |
| `isRunning()` | Check running status |

**Emits events:** `scheduler:start`, `scheduler:trigger`, `scheduler:complete`

**Types:**
```typescript
type TimeProvider = {
  getMsUntilTime(time: string): number;
  getMsUntilCron(cron: string): number;
  sleep(ms: number): Promise<void>;
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
| `constructor()` | Creates UniversalScheduler with executor callback; takes optional EventBus (falls back to AppContext) |
| `start()` | Start all queues (re-registers event listeners) |
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

**EventBus integration:** subscribes to `queue:task:start`, `queue:task:complete`, `queue:task:error`, `queue:idle`, `queue:wait` for monitoring/logging. Unsubscribe functions are stored and released in `stop()`, re-registered on `start()`.

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
| `constructor()` | Creates with executor callback and optional EventBus |
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
| `setOnWait()` | ⚠️ Deprecated: wait callback (only tests use it; superseded by `queue:wait` event) |
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

**Emits events (when EventBus provided):** `queue:register`, `queue:add`, `queue:task:start`, `queue:task:complete`, `queue:task:error`, `queue:idle`, `queue:wait`, `queue:drain`, `queue:cleared`, `queue:reset`

---

### `src/queue/retry-strategy.ts`

**Responsibility:** Retry helpers with exponential backoff and jitter

**Functions:**

| Function | Purpose |
|----------|---------|
| `calculateBackoff()` | Backoff delay = initialTimeout × multiplier^attempt ± jitter (never negative) |
| `shouldRetry()` | Attempt-budget check against `maxRetries` |
| `getRetryDelay()` | Delay before the next retry |
| `retryWithBackoff()` | Run an async fn with retries (optional `onRetry` callback); throws last error when exhausted |
| `sleep()` | Async delay |

---

### `src/queue/types.ts`

**Responsibility:** Queue-layer type definitions

**Types:**
```typescript
type CheckSettings      // count / checkInterval / downloadTypes
type DownloadSettings   // downloadDir, downloadDelay, maxRetries, initialTimeout, backoff, jitter, minDuration
type CheckQueueItem     // seriesUrl, attemptNumber, scheduledTime
type DownloadQueueItem  // seriesUrl, episode, scheduledTime
type QueueProcessor<T> / ExecutorCallback<T>  // processor / executor callbacks
type QueueStatus, CheckResult, DownloadResult, TaskItem<T>, SchedulerConfig
type ScheduledTask      // CheckQueueItem | DownloadQueueItem union
```

(`RetryConfig` is deprecated in favor of `DownloadSettings`.)

---

### `src/events/` — Events Layer

#### `src/events/event-bus.ts`

**Responsibility:** Central typed pub/sub bus (wrapper over Emittery)

**Exports:** `EventBus` class, `getEventBus()` / `resetEventBus()` singleton accessors

| Method | Purpose |
|--------|---------|
| `emit()` | Emit event, await all handlers |
| `emitSync()` | Fire-and-forget emit |
| `on()` | Subscribe to one event (returns unsubscribe fn) |
| `onMany()` | Subscribe to multiple events |
| `onAny()` | Subscribe to all events |
| `once()` | One-time subscription |
| `onWithSignal()` | Subscription tied to AbortSignal |
| `waitFor()` | Promise-based wait for next event |
| `listenerCount()` | Number of listeners for event |
| `clearListeners()` | Remove listeners |

#### `src/events/event-types.ts`

**Responsibility:** Type-safe event payload definitions — the `WetvloEvent` map,
grouped under 9 prefixes

| Prefix | Events |
|--------|--------|
| `scheduler` | `scheduler:start`, `scheduler:trigger`, `scheduler:complete` |
| `queue` | `queue:register`, `queue:add`, `queue:task:start/complete/error`, `queue:drain`, `queue:idle`, `queue:cleared`, `queue:reset`, `queue:wait` |
| `download` | `download:start`, `download:progress`, `download:complete`, `download:error`, `download:cleanup` |
| `scraping` | `scraping:start`, `scraping:complete`, `scraping:error` |
| `state` | `state:load`, `state:save`, `state:update` |
| `notification` | `notification:send`, `notification:error` |
| `app` | `app:start`, `app:shutdown` |
| `config` | `config:reload`, `config:error` |
| `health` | `health:check` |

---

### `src/queue/typed-queue.ts`

**Responsibility:** Passive FIFO store for tasks of one type (delays + cooldown, no execution)

**Class:** `TypedQueue<TaskType>`

**Methods:**

| Method | Purpose |
|--------|---------|
| `add(task, delay?)` | Add task with optional availability delay |
| `addFirst(task, delay?)` | Add to queue front (priority) |
| `getNext()` | Pop next task |
| `peekNext()` | Peek next task without removing |
| `canStart(now)` | Ready to execute (idle, past cooldown, head past its delay) |
| `markStarted()` | Mark execution started |
| `markCompleted(cooldownMs)` | Mark complete + start cooldown |
| `markFailed(cooldownMs)` | Mark failed + start cooldown |
| `hasTasks()` | Check for tasks |
| `getNextAvailableTime()` | Next time this queue can start a task |
| `getQueueLength()` | Queue length |
| `getIsExecuting()` | Execution flag |
| `getCooldownMs()` / `setCooldownMs()` | Cooldown accessors |
| `clear()` | Clear queue |
| `reset()` | Reset to initial state (forces immediate execution) |
| `getStatus()` | Status snapshot (length / executing / nextAvailableAt / cooldown / canStartNow) |

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
async extractEpisodes(url: string, cookies?: string): Promise<Episode[]>
```

---

### `src/handlers/impl/iqiyi-handler.ts`

**Responsibility:** Extractor for iq.com

**Class:** `IQiyiHandler extends BaseHandler`

**Methods:**
```typescript
getDomain(): string  // "iq.com"
async extractEpisodes(url: string, cookies?: string): Promise<Episode[]>
```

---

### `src/handlers/impl/mgtv-handler.ts`

**Responsibility:** Extractor for mgtv.com

**Class:** `MGTVHandler extends BaseHandler`

**Methods:**
```typescript
getDomain(): string  // "mgtv.com"
async extractEpisodes(url: string, cookies?: string): Promise<Episode[]>
```

Teaser clips ("Preview EP N" — short promos occupying an episode slot before
the real episode is released) are typed `teaser` and excluded by default
`check.downloadTypes`. Detection markers: `t2`/`t3` title prefix "Preview",
corner badge `font: "Pre"`, or `isIntact: "3"` (full episodes carry "1").
The episode list places a preview before the full episode of the same
number, so dedup lets a non-teaser displace a teaser occupying the slot.

---

### `src/handlers/impl/youku-handler.ts`

**Responsibility:** Extractor for youku.tv

**Class:** `YoukuHandler extends BaseHandler`

**Methods:**
```typescript
getDomain(): string  // "youku.tv"
async extractEpisodes(url: string, cookies?: string): Promise<Episode[]>
```

Parses the episode list embedded in the episode page's SSR HTML (`type:10013`
anthology nodes, located by string anchor and expanded with a string-aware
balanced-brace scan; no list API). Numbering follows each item's numeric
`stage` — never list position; availability marks map '' → available,
VIP → vip, Express/TVOD → express (unknown marks fail safe to express with a
warning); trailer rows are skipped and duplicate encodevids are deduped. An
unparseable page warns and returns an empty list so the "no episodes" retry
flow engages.

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
};
```

---

## 📥 Downloader Layer

### `src/downloader/download-manager.ts`

**Responsibility:** Download orchestration via the downloader registry (yt-dlp default)

**Class:** `DownloadManager`

**Methods:**

| Method | Purpose |
|--------|---------|
| `download()` | Download episode (picks downloader via `downloaderRegistry.getDownloader(url)`) |
| `checkYtDlpInstalled()` | Check yt-dlp presence (static) |
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

### `src/downloader/impl/mgtv-downloader.ts`

**Responsibility:** Downloader for MGTV International (mgtv.com / w.mgtv.com) —
currently NOT registered: MGTV downloads route to yt-dlp's native MGTV
extractor (the intl tinker dispatch tier answered 618 "busy" to certain IPs).
Kept for a one-line revert in `app.ts` if the intl tier recovers.

**Class:** `MgtvDownloader extends BaseDownloader`

Resolves the signed HLS playlist via the tinker API (`mgtvApi`: player info →
source streams → m3u8) using VIP-account cookies, then hands it to yt-dlp
(`--referer https://w.mgtv.com/`).
Subtitles are downloaded separately and saved next to the video as
`<name>.<lang>.srt`; subtitle failures never fail the video.

---

### `src/downloader/impl/youku-downloader.ts`

**Responsibility:** Downloader for Youku International (youku.tv)

**Class:** `YoukuDownloader extends BaseDownloader`

Mints the signed HLS playlist through the ups API right before downloading
(signed URLs expire after ~5 h) and hands it to yt-dlp without cookies — the
signature is the only auth, plus a youku.tv referer. A 6-minute trial payload
(stale/missing session, locked/TVOD episode) raises `TrialContentError` — or,
in `subsOnly` mode, saves the subtitles only and postpones the video.
Subtitles are unsigned .ass CDN links saved as `<name>.<lang>.ass` sidecars;
subtitle failures never fail the video.

---

### `src/downloader/lib/mgtv-api.ts`

**Responsibility:** MGTV International API layer (tinker*.glb.mgtv.com) —
everything site-specific about MGTV: `tk2` auth signature (`makeTk2`),
mgtv.com-only cookie header (`readMgtvCookieHeader`), JSONP unwrap, and the
endpoints for player info, source streams, signed m3u8 resolution, and
subtitle list/resolve/download. Exports the `MgtvApi` injectable type and the
`mgtvApi` instance, plus `MGTV_UA` and the stream/subtitle result types.

---

### `src/downloader/lib/mgtv-quality.ts`

**Responsibility:** `pickBestStream()` — highest numeric `filebitrate` among
streams with a non-empty url; locked VIP streams (empty url = cookies
missing/expired or no VIP) are skipped and reported via the `degraded` flag

---

### `src/downloader/lib/mgtv-subs.ts`

**Responsibility:** Subtitle matching for MGTV: `matchSubLangs()` filters
subtitle entries against yt-dlp-style `subLangs` patterns (`ru.*`/`ru*`
prefix match, `ru` exact match, compared against the lowercased language
code), `langTag()` gives the filename language tag (e.g. `ZH_CN` → `zh_cn`)

---

### `src/downloader/lib/youku-api.ts`

**Responsibility:** Youku International API layer (h5 mtop gateway
acs.youku.tv, `mtop.youku.play.ups.appinfo.get`): `mintUps()` mints the
signed playlist result (title, duration, streams, subtitles, trial flag),
`readYoukuCookiePairs()` collects youku.tv/youku.com cookie pairs deduped by
name with domain precedence (duplicate names make youku answer HTTP 400),
plus `pickBestStream()` (DRM streams filtered), `matchYoukuSubLangs()` /
`fetchSubtitle()`, `extractVideoId()`, and the mtop signing/transport
helpers. Exports the `YoukuApi` injectable type and the `youkuApi` instance.
`trial: true` payloads are 6-minute previews — their streams must never be
downloaded, but they still carry the full subtitle array.

---

### `src/downloader/downloader-registry.ts`

**Responsibility:** Downloader registration and retrieval

**Exports:**
```typescript
export class DownloaderRegistry {
  register(downloader: Downloader): void  // custom downloaders, checked first
  getDownloader(url: string): Downloader  // first supporting, else default YtDlpDownloader
}
export const downloaderRegistry = new DownloaderRegistry();
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
| `addDownloadedEpisode()` | Add episode to state (upgrades a `"NN:subs"` marker to `"NN"`) |
| `addSubsOnlyEpisode()` | Mark `"NN:subs"` subtitles-only placeholder |
| `isSubsOnly()` | Check whether an episode carries the `"NN:subs"` marker |
| `getSeriesEpisodes()` | Get all series episodes |

State entries carry `"NN:subs"` markers (subtitles-only placeholders, not
counted by `isDownloaded`) that convert back to `"NN"` when the video later
downloads.

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
| `listSeries()` | List all series configs |
| `listSeriesUrls()` | List all series URLs |
| `listDomains()` | List configured domains |

**Resolution levels:**
```typescript
resolve(url, 'global')   // Global settings
resolve(url, 'domain')   // Domain settings
resolve(url)             // Series settings (highest priority)
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
export const defaults: DefaultConfig = {
  check: {
    count: 3,
    checkInterval: 600,          // seconds
    downloadTypes: ['available']
  },
  download: {
    downloadDir: './downloads',
    tempDir: './downloads',
    downloadDelay: 10,           // seconds
    maxRetries: 3,
    initialTimeout: 5,           // seconds
    backoffMultiplier: 2,
    jitterPercentage: 10,
    minDuration: 0,              // 0 = disabled
    subsBeforeVideo: false
  },
  notifications: { consoleMinLevel: 'info' },
  telegram: { minLevel: 'error' },
  stateFile: 'wetvlo-state.json'
};

export function getDefaults(): DefaultConfig  // returns `defaults`
```

---

## 🔔 Notifications Layer

### `src/notifications/notifier.ts`

**Responsibility:** Notifier interface

**Type:**
```typescript
type Notifier = {
  notify(level: NotificationLevel, message: string): Promise<void> | void
  progress(message: string): Promise<void> | void
  endProgress(): Promise<void> | void
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

**Responsibility:** Console output (non-blocking)

**Class:** `ConsoleNotifier`

All output goes through `ConsoleQueue` (setImmediate-deferred) so logging never blocks the main event loop; progress lines are rewritten in place.

---

### `src/notifications/telegram-notifier.ts`

**Responsibility:** Telegram sending

**Class:** `TelegramNotifier`

Sends via `fetch` to the Bot API (HTML parse mode, 4000-char truncation). All errors — including network failures such as ECONNRESET — are caught and logged (`Telegram notification failed: ...`), never thrown to the caller.

---

### `src/notifications/event-notifier.ts`

**Responsibility:** Bridge from EventBus to a Notifier

**Class:** `EventNotifier`

Subscribes to bus events and forwards them as notifications to the wrapped notifier; keeps unsubscribe functions for cleanup.

---

### `src/notifications/notification-level.ts`

**Responsibility:** Notification levels

**Exports:**
```typescript
// String-valued enum built via createEnum (NOT a numeric TS enum):
export const NotificationLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  SUCCESS: 'success',
  HIGHLIGHT: 'highlight',
  WARNING: 'warning',
  ERROR: 'error'
} as const;

// Filtering priorities (lower = less severe):
export const LEVEL_PRIORITIES = {
  debug: 0, info: 1, success: 2, highlight: 3, warning: 4, error: 5
};
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
| `formatDuration()` | Human-readable duration for ms |

---

### `src/utils/url-utils.ts`

**Functions:**

| Function | Purpose |
|----------|---------|
| `extractDomain()` | Extract domain from URL |
| `isValidUrl()` | Validate URL |
| `normalizeUrl()` | Normalize URL |

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
| `getVideoDuration()` | Duration in seconds via ffprobe (0 on failure) |
| `checkFfprobeInstalled()` | ffprobe presence |

---

### `src/utils/deep-merge.ts`

**Functions:**

| Function | Purpose |
|----------|---------|
| `deepMerge()` | Recursive object merge |
| `type DeepMerge` | Type for merged result |

---

### `src/utils/firefox-cookies.ts`

**Responsibility:** Read cookies from a Firefox profile SQLite database for a target URL
(spec format `"firefox:<profile>"`; profile matches a Firefox Profiles directory
by full name or suffix after the dot)

---

### `src/utils/firefox-rescue.ts`

**Responsibility:** Session rescue: on `CookieError`/`TrialContentError` open the
series page in the configured Firefox profile (`refreshSessionsViaTab` — CLI spawn,
graceful close when we launched the browser, cookie snapshot before/after),
`CookieSessionRescue` adds a per-domain cooldown and user notifications

---

### `src/utils/logger.ts`

**Responsibility:** Colored timestamped console logger — `Logger` class with
level filtering (`debug`/`info`/`success`/`warning`/`error`/`highlight`),
`LogLevel` constants and a default `logger` instance

---

### `src/utils/create-enum.ts`

**Responsibility:** `createEnum()` helper — builds an uppercase-keyed string
enum object, a matching Zod schema, and a string-literal type from a list of
values (used by `EpisodeType` and `NotificationLevel`)

---

### `src/utils/env-resolver.ts`

**Responsibility:** `${VAR}` environment-variable resolution in strings
(`resolveEnv()`, throws when the variable is unset) and recursively through
config objects (`resolveEnvRecursive()`)

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
  extractedAt: Date
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
type State = {
  version: string            // "3.0.0"
  series: Record<string, string[]>  // series name → sorted episode numbers ("01", "02")
}
function createEmptyState(): State
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
// String-valued enum built via createEnum:
export type EpisodeType =
  | 'available' | 'vip' | 'svip' | 'preview' | 'locked' | 'teaser' | 'express'
// plus: EpisodeType object (UPPERCASE key → value), EpisodeTypeSchema (Zod),
//       EpisodeTypeValues
```

---

## ❌ Errors Layer

### `src/errors/custom-errors.ts`

**Classes:**

| Class | Extends | Purpose |
|-------|---------|---------|
| `WetvloError` | Error | Base error |
| `ConfigError` | WetvloError | Configuration error |
| `StateError` | WetvloError | State file error |
| `HandlerError` | WetvloError | Episode extraction error (carries url) |
| `DownloadError` | WetvloError | Download error (carries url) |
| `TrialContentError` | WetvloError | Trial/preview content served instead of the full episode (message, url) — triggers session rescue |
| `NotificationError` | WetvloError | Notification error |
| `CookieError` | WetvloError | Cookie extraction error (session state) — triggers session rescue |
| `SchedulerError` | WetvloError | Scheduling error |

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
│         │ • EventBus                     │              │
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

This document deliberately carries no hard test counts (they rot) — run
`bun test` and keep the suite all green.

---

For more details see:
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Architecture layers and patterns
- [EXECUTION_FLOW.md](./EXECUTION_FLOW.md) — Detailed execution flow
