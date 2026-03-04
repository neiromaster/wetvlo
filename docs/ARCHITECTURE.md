# Architecture Overview

## Architecture Layers

### 1. Entry Point

| File | Responsibility | Key Functions |
|------|----------------|---------------|
| `src/index.ts` | CLI launch via cmd-ts | `main()` |
| `src/app.ts` | Orchestration, graceful shutdown | `runApp()`, `handleShutdown()` |

**Dependency Injection in `app.ts`:**
```typescript
type AppDependencies = {
  loadConfig: typeof loadConfig,
  checkYtDlpInstalled: () => Promise<boolean>,
  createDownloadManager: () => DownloadManager,
  createScheduler: typeof Scheduler
};
```

---

### 2. Business Logic

#### Scheduler (`src/scheduler/scheduler.ts`)

**Responsibility:** Managing launch times (cron/startTime), triggering checks

**Key Methods:**
- `start()` — start scheduler
- `scheduleNextBatch()` — calculate time until next batch
- `groupConfigsBySchedule()` — group by startTime/cron
- `runConfigs()` — add all series to QueueManager
- `triggerAllChecks()` — immediate trigger of all checks

**Pattern:** Time-based scheduling + queue delegation

---

#### QueueManager (`src/queue/queue-manager.ts`)

**Responsibility:** Queue management, retry handling with exponential backoff

**Key Methods:**
- `addSeriesCheck()` — create check queue for series
- `addEpisodes()` — add episodes to download queue
- `executeCheck()` — execute check task
- `executeDownload()` — execute download task
- `performCheck()` — extract episodes via handler
- `calculateBackoff()` — exponential backoff with jitter

**Creates queues:**
- `check:{domain}:{hash}` — one per series (isolated interval)
- `download:{domain}` — shared per domain (shared cooldown)

---

#### UniversalScheduler (`src/queue/universal-scheduler.ts`)

**Responsibility:** Global executor — only ONE task runs at a time

**Key Methods:**
- `registerQueue()` — register queue with cooldown
- `addTask()` — add task to queue
- `addPriorityTask()` — add to queue front (for retries)
- `scheduleNext()` — trigger next task
- `trySchedule()` — round-robin queue selection
- `markTaskComplete/Failed()` — complete task

**Algorithm:**
1. Check `executorBusy` — if busy, exit
2. Round-robin through all queues
3. Find queue with `canStart(now) == true`
4. Execute task via callback
5. Task calls `markTaskComplete()` → `scheduleNext()`

**Event-driven:** no polling, timer and callback based

---

#### Handlers (`src/handlers/`)

**Responsibility:** HTML parsing, episode data extraction (domain-specific)

**Base Class:** `BaseHandler` (`src/handlers/base/base-handler.ts`)
- `supports(url)` — check URL support
- `fetchHtml()` — load HTML with cookies
- `parseHtml()` — Cheerio parsing
- `parseEpisodeNumber()` — extract episode number
- `parseEpisodeType()` — determine type (episode/pv/extra)

**Implementations:**
- `WeTVHandler` — wetv.vip
- `IQiyiHandler` — iq.com
- `MGTVHandler` — mgtv.com

**Pattern:** Strategy + Template Method

---

### 3. Infrastructure

#### ConfigRegistry (`src/config/config-registry.ts`)

**Responsibility:** 4-level configuration merge

**Methods:**
- `resolve(url, level)` — get config for URL
  - `level: 'global'` — global settings
  - `level: 'domain'` — domain settings
  - `level: 'series'` — series settings

**Merge order (low → high priority):**
1. `defaults` (config-defaults.ts)
2. `globalConfigs` (config.yaml)
3. `domainConfigs` (config.yaml)
4. `series` (config.yaml)

---

#### StateManager (`src/state/state-manager.ts`)

**Responsibility:** JSON persistence, mutex for concurrent operations

**Methods:**
- `isDownloaded()` — check if episode is downloaded
- `addDownloadedEpisode()` — add episode to state
- `getSeriesEpisodes()` — get all series episodes
- `withLock()` — mutex for safe writes

**State file format:**
```json
{
  "version": "2.0.0",
  "series": {
    "https://wetv.vip/play/abc": {
      "name": "Series Name",
      "episodes": {
        "01": { "url": "...", "filename": "...", "downloadedAt": "...", "size": 12345 }
      }
    }
  },
  "lastUpdated": "2025-01-23T20:10:00+08:00"
}
```

---

#### DownloadManager (`src/downloader/download-manager.ts`)

**Responsibility:** Running yt-dlp, validation, cleanup of .part files

**Methods:**
- `download()` — download episode
- `cleanupEpisodeArtifacts()` — delete `.part`, `.tmp` on error
- `verifyDownload()` — verify file size
- `checkYtDlpInstalled()` — check yt-dlp presence

**Artifacts:** deletes files matching pattern `${filenameWithoutExt}.*`

---

#### AppContext (`src/app-context.ts`)

**Responsibility:** Global service locator (DI container)

**Methods:**
- `initialize()` — initialize with services
- `getConfig()` — get ConfigRegistry
- `getNotifier()` — get Notifier
- `getStateManager()` — get StateManager
- `reloadConfig()` — reload config
- `reset()` — reset (for tests)

**Pattern:** Service Locator (Singleton)

---

## 📊 Dependency Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        app.ts                               │
│  - Loads config                                             │
│  - Creates all services                                     │
│  - Initializes AppContext                                   │
│  - Starts Scheduler                                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ Scheduler│   │ConfigReg │   │Notifier  │
    └─────┬────┘   └──────────┘   └──────────┘
          │
          ▼
    ┌──────────────┐
    │ QueueManager │◄───────┐
    └──────┬───────┘        │
           │                │
           ▼                │
    ┌──────────────────┐    │
    │UniversalScheduler│    │
    └──────┬───────────┘    │
           │                │
           ▼                │
    ┌────────────────────────────────┐
    │  executor callback             │
    │  (QueueManager.executeTask)    │
    └────────────┬───────────────────┘
                 │
      ┌──────────┴──────────┐
      │                     │
      ▼                     ▼
┌───────────┐         ┌───────────┐
│ Handlers  │         │Downloader │
│ (extract) │         │ (yt-dlp)  │
└─────┬─────┘         └─────┬─────┘
      │                     │
      └──────────┬──────────┘
                 ▼
          ┌──────────┐
          │  State   │
          │ Manager  │
          └──────────┘
```

---

## 🔑 Architectural Patterns

| Pattern | Where Used | Why |
|---------|-----------|-----|
| **Service Locator** | `AppContext` | Global service access |
| **Strategy** | `Handlers` | Domain-specific logic |
| **Template Method** | `BaseHandler` | Common code for all handlers |
| **Queue-based** | `QueueManager` | Task decomposition |
| **Round-robin** | `UniversalScheduler` | Fair scheduling |
| **Event-driven** | `UniversalScheduler` | No polling |
| **Mutex** | `StateManager.withLock` | Concurrent write safety |
| **Registry** | `handlerRegistry`, `downloaderRegistry` | Dynamic registration |
| **Factory** | `QueueManagerFactory` | DI for tests |

---

## 🔄 Data Flow

### Configuration Flow
```
config.yaml
  → loadConfig()
  → ConfigRegistry (pre-merge all levels)
  → AppContext.initialize()
  → registry.resolve(url, level)
```

### Task Execution Flow
```
Scheduler.start()
  → scheduleNextBatch()
  → runConfigs()
  → QueueManager.addSeriesCheck()
  → UniversalScheduler.addTask()
  → scheduleNext()
  → trySchedule()
  → executeTask()
  → executeCheck/Download()
  → markTaskComplete()
  → scheduleNext()  # recursion
```

### Episode Discovery Flow
```
executeCheck()
  → performCheck()
  → handler.extractEpisodes()
  → stateManager.isDownloaded() filter
  → addEpisodes()
  → UniversalScheduler.addTask() × N
```

---

## 📈 Scaling

### Adding a New Domain

1. Create `src/handlers/impl/newdomain-handler.ts`:
```typescript
export class NewDomainHandler extends BaseHandler {
  getDomain() { return 'newdomain.com'; }

  async extractEpisodes(url: string): Promise<Episode[]> {
    // HTML parsing logic
  }
}
```

2. Register in `src/app.ts`:
```typescript
handlerRegistry.register(new NewDomainHandler());
```

3. Add domain settings in `config.yaml`:
```yaml
domainConfigs:
  newdomain.com:
    check:
      count: 3
      interval: 600
```

### Adding a New Downloader

1. Implement downloader interface
2. Register in `downloaderRegistry`
3. UniversalScheduler will pick it up automatically

---

## ⚠️ Important Limitations

1. **Sequential processing** — only one task globally
2. **No parallel downloads** — even across different domains
3. **Global executorBusy flag** — blocks all queues
4. **State file locking** — via Promise chains, not fs.lock
5. **No distributed execution** — single process only

---

## 🧪 Testing

### Unit Tests
- `**/*.test.ts` — unit tests
- Use dependency injection

### Regression Tests
- `scheduler-regression.test.ts` — documents past bugs
- Shows multi-domain blocking examples

### Mock Strategies
- `AppDependencies` — DI for mocks
- `defaultDependencies` — production implementations
- Tests replace dependencies
