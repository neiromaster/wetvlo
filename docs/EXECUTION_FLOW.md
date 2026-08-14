# Execution Flow: Detailed Breakdown

## Scenario

Consider the complete path from config to download for this scenario:
- **2 series** in config with same `startTime`
- **2 new episodes** found for each

```yaml
# config.yaml
series:
  - url: "https://wetv.vip/play/series-a"
    name: "Series A"
    startTime: "10:00"

  - url: "https://iq.com/play/series-b"
    name: "Series B"
    startTime: "10:00"
```

---

## Phase 1: Initialization

```
📁 index.ts:main()
  └─ run(cli)  [cmd-ts library]
       └─ 📁 app.ts:runApp()
            ├─ loadConfig("./config.yaml")
            │   └─ YAML → config object
            │
            ├─ new ConfigRegistry(config)
            │   └─ Pre-merge all levels (defaults + global + domain + series)
            │
            ├─ new CompositeNotifier()
            │   ├─ ConsoleNotifier (always)
            │   └─ TelegramNotifier (if configured)
            │
            ├─ getEventBus()
            │   └─ Global EventBus singleton (src/events/event-bus.ts)
            │
            ├─ AppContext.initialize(configRegistry, notifier, undefined, eventBus)
            │   └─ Stores in singleton
            │
            ├─ handlerRegistry.register(new WeTVHandler())
            ├─ handlerRegistry.register(new IQiyiHandler())
            ├─ handlerRegistry.register(new MGTVHandler())
            │
            ├─ new DownloadManager()
            │
            └─ new Scheduler(configs, downloadManager, options, _, eventBus)
                 └─ Creates QueueManager with executor callback and EventBus
                      (UniversalScheduler emits queue:* events,
                       QueueManager subscribes for monitoring/logging)
```

---

## Phase 2: Scheduler Start

```
📁 scheduler/scheduler.ts:start()
  │
  ├─ this.running = true
  │
  ├─ emit scheduler:start event
  │
  ├─ queueManager.start()
  │   └─ 📁 queue/universal-scheduler.ts:start()
  │       └─ Initialize internal state
  │
  ├─ groupConfigsBySchedule()
  │   └─ Group series by startTime
  │       Result:
  │       Map {
  │         "10:00" => [
  │           { url: "https://wetv.vip/play/series-a", name: "Series A", ... },
  │           { url: "https://iq.com/play/series-b", name: "Series B", ... }
  │         ]
  │       }
  │
  └─ scheduleNextBatch()
       │
       ├─ Calculate time until 10:00
       │   timeProvider.getMsUntilTime("10:00")
       │
       ├─ Wait:
       │   sleep(msUntil)
       │
       └─ runConfigs([series-a, series-b])
            │
            └─ For each series:
                queueManager.addSeriesCheck(series.url)
```

---

## Phase 3: Queue Creation (10:00)

### Series A

```
📁 queue/queue-manager.ts:addSeriesCheck("https://wetv.vip/play/series-a")
  │
  ├─ domain = "wetv.vip"
  │
  ├─ registerDownloadQueue("wetv.vip")
  │   └─ 📁 queue/queue-manager.ts:registerDownloadQueue()
  │       ├─ queueName = "download:wetv.vip"
  │       ├─ resolve config for domain
  │       │   downloadDelay = 10 (seconds)
  │       └─ scheduler.registerQueue("download:wetv.vip", 10000)
  │
  ├─ registerSeriesCheckQueue("wetv.vip", "https://wetv.vip/play/series-a")
  │   └─ 📁 queue/queue-manager.ts:registerSeriesCheckQueue()
  │       ├─ hash = md5(url).substring(0, 12) = "a1b2c3d4e5f6"
  │       ├─ queueName = "check:wetv.vip:a1b2c3d4e5f6"
  │       ├─ resolve config for series
  │       │   checkInterval = 600 (seconds = 10 minutes)
  │       └─ scheduler.registerQueue("check:wetv.vip:a1b2c3d4e5f6", 600000)
  │
  └─ scheduler.addTask("check:wetv.vip:a1b2c3d4e5f6", {
       seriesUrl: "https://wetv.vip/play/series-a",
       attemptNumber: 1,
       retryCount: 0
     })
```

### Series B

```
Similarly created:
  - queueName: "download:iq.com"
  - queueName: "check:iq.com:x9y8z7w6v5u4"
  - task: { seriesUrl: "https://iq.com/play/series-b", attemptNumber: 1, ... }
```

### State After Population

```
UniversalScheduler queues:
  ┌─────────────────────────────────────┐
  │ check:wetv.vip:a1b2c3d4e5f6         │
  │   → [{seriesUrl, attemptNumber: 1}] │
  ├─────────────────────────────────────┤
  │ check:iq.com:x9y8z7w6v5u4           │
  │   → [{seriesUrl, attemptNumber: 1}] │
  ├─────────────────────────────────────┤
  │ download:wetv.vip                   │
  │   → []                              │
  ├─────────────────────────────────────┤
  │ download:iq.com                     │
  │   → []                              │
  └─────────────────────────────────────┘

roundRobinIndex = 0
executorBusy = false
```

---

## Phase 4: Round-robin Execution (Check)

### Step 1: Series A check

```
📁 queue/universal-scheduler.ts:scheduleNext()
  │
  ├─ trySchedule()
  │   ├─ executorBusy = false ✓
  │   ├─ roundRobinIndex = 0
  │   ├─ Selects first queue: "check:wetv.vip:a1b2c3d4e5f6"
  │   ├─ queue.canStart(now) = true ✓
  │   ├─ task = queue.getNext() → {seriesUrl, attemptNumber: 1}
  │   ├─ executorBusy = true  # BLOCKS executor
  │   ├─ roundRobinIndex = 1
  │   └─ executeTask("check:wetv.vip:a1b2c3d4e5f6", task)
  │        ↓
  │   📁 queue/queue-manager.ts:executeTask()
  │     └─ executeCheck(item, "wetv.vip", "check:wetv.vip:a1b2c3d4e5f6")
  │          ↓
  │       📁 queue/queue-manager.ts:executeCheck()
  │         ├─ Refresh cookies (if needed)
  │         └─ performCheck(handler, seriesUrl, config, attemptNumber=1, "wetv.vip")
  │              ↓
  │           📁 queue/queue-manager.ts:performCheck()
  │             ├─ handler.extractEpisodes("https://wetv.vip/play/series-a")
  │             │   ↓
  │             │  📁 handlers/impl/wetv-handler.ts:extractEpisodes()
  │             │    ├─ fetchHtml() → HTML
  │             │    ├─ parseHtml() → Cheerio
  │             │    └─ Extract episodes:
  │             │        [
  │             │          {number: 1, url: "...", type: "episode", title: "..."},
  │             │          {number: 2, url: "...", type: "episode", title: "..."},
  │             │          {number: 3, url: "...", type: "episode", title: "..."},
  │             │          ...
  │             │        ]
  │             │
  │             ├─ stateManager.isDownloaded(ep1) = false  # New!
  │             ├─ stateManager.isDownloaded(ep2) = false  # New!
  │             ├─ stateManager.isDownloaded(ep3) = true   # Already downloaded
  │             │
  │             └─ return {
  │                    hasNewEpisodes: true,
  │                    episodes: [ep1, ep2]
  │                  }
  │
  │         ├─ addEpisodes("https://wetv.vip/play/series-a", [ep1, ep2])
  │         │   ↓
  │         │  📁 queue/queue-manager.ts:addEpisodes()
  │         │    ├─ registerDownloadQueue("wetv.vip")  # already exists
  │         │    ├─ downloadDelay = 10 (seconds)
  │         │    │
  │         │    ├─ For ep1:
  │         │    │   └─ scheduler.addTask("download:wetv.vip", {
  │         │    │        seriesUrl: "https://wetv.vip/play/series-a",
  │         │    │        episode: ep1,
  │         │    │        retryCount: 0
  │         │    │      }, delayMs=0)  # No delay
  │         │    │
  │         │    └─ For ep2:
  │         │        └─ scheduler.addTask("download:wetv.vip", {
  │         │             seriesUrl: "https://wetv.vip/play/series-a",
  │         │             episode: ep2,
  │         │             retryCount: 0
  │         │           }, delayMs=10000)  # After 10 sec
  │         │
  │         └─ scheduler.markTaskComplete("check:wetv.vip:a1b2c3d4e5f6", 600000)
  │              └─ scheduleNext()  # Trigger next task
```

### State After Series A Check

```
UniversalScheduler queues:
  ┌─────────────────────────────────────┐
  │ check:wetv.vip:a1b2c3d4e5f6         │
  │   → []                              │ # Done, cooldown 10 min
  ├─────────────────────────────────────┤
  │ check:iq.com:x9y8z7w6v5u4           │
  │   → [{seriesUrl, attemptNumber: 1}] │
  ├─────────────────────────────────────┤
  │ download:wetv.vip                   │
  │   → [ep1, ep2]                      │ # 2 tasks in queue!
  ├─────────────────────────────────────┤
  │ download:iq.com                     │
  │   → []                              │
  └─────────────────────────────────────┘

roundRobinIndex = 1
executorBusy = false  # markTaskComplete unblocked
```

### Step 2: Series B check

```
📁 queue/universal-scheduler.ts:scheduleNext()
  │
  ├─ trySchedule()
  │   ├─ executorBusy = false ✓
  │   ├─ roundRobinIndex = 1
  │   ├─ Selects: "check:iq.com:x9y8z7w6v5u4"
  │   └─ executeTask(...)
  │        ↓
  │       Similar to Series A:
  │       - extractEpisodes() → [ep3, ep4, ep5]
  │       - isDownloaded(ep3) = false  # New!
  │       - isDownloaded(ep4) = false  # New!
  │       - isDownloaded(ep5) = true   # Already downloaded
  │       - addEpisodes([ep3, ep4])
  │
  └─ scheduleNext()
```

### State After Series B Check

```
UniversalScheduler queues:
  ┌─────────────────────────────────────┐
  │ check:wetv.vip:a1b2c3d4e5f6         │
  │   → []                              │ # cooldown
  ├─────────────────────────────────────┤
  │ check:iq.com:x9y8z7w6v5u4           │
  │   → []                              │ # cooldown
  ├─────────────────────────────────────┤
  │ download:wetv.vip                   │
  │   → [ep1, ep2]                      │
  ├─────────────────────────────────────┤
  │ download:iq.com                     │
  │   → [ep3, ep4]                      │ # 2 tasks in queue!
  └─────────────────────────────────────┘

roundRobinIndex = 2
```

---

## Phase 5: Downloads (Round-robin)

### Step 1: ep1 (wetv.vip)

```
📁 queue/universal-scheduler.ts:scheduleNext()
  │
  ├─ trySchedule()
  │   ├─ Check queues → cooldown, skip
  │   ├─ roundRobinIndex = 2
  │   ├─ Selects: "download:wetv.vip" (ep1)
  │   ├─ executorBusy = true
  │   └─ executeTask("download:wetv.vip", ep1)
  │        ↓
  │   📁 queue/queue-manager.ts:executeDownload(ep1, "wetv.vip")
  │     └─ downloadManager.download("https://wetv.vip/play/series-a", ep1)
  │          ↓
  │       📁 downloader/download-manager.ts:download()
  │         ├─ isDownloaded() = false ✓
  │         ├─ cleanupEpisodeArtifacts()  # Delete .part files
  │         ├─ downloader.download(ep1, targetDir, filename)
  │         │   ↓
  │         │  📁 downloader/impl/yt-dlp-downloader.ts:download()
  │         │    └─ execa("yt-dlp", [...])
  │         │
  │         ├─ verifyDownload(filename)  # Check size
  │         ├─ VideoValidator.getVideoDuration()
  │         ├─ stateManager.addDownloadedEpisode()
  │         └─ return true
  │
  └─ scheduler.markTaskComplete("download:wetv.vip", 10000)
       └─ scheduleNext()
```

### Step 2: ep3 (iq.com)

```
executorBusy = false
trySchedule()
  ├─ roundRobinIndex = 3
  ├─ Selects: "download:iq.com" (ep3)
  └─ executeTask(...) → download ep3
```

### Step 3: ep2 (wetv.vip)

```
markTaskComplete("download:iq.com", 10000)
  └─ scheduleNext()
       └─ trySchedule()
            ├─ roundRobinIndex = 0
            ├─ ep2 was added with delay=10000ms (10 sec)
            └─ If currentTime >= addTime + 10000ms → execute
```

### Step 4: ep4 (iq.com)

```
Similar to ep2, if 10 sec passed
```

---

## 📊 Timeline Diagram

```
TIME     │ check:wetv │ check:iq │ dl:wetv        │ dl:iq
─────────┼───────────┼──────────┼────────────────┼─────────
10:00:00 │ EXECUTE   │ WAIT     │ []             │ []
         │ (Series A)│          │                │
10:00:05 │ cooldown  │ EXECUTE  │ [ep1, ep2]     │ []
         │ 10m       │ (Series B)│                │
10:00:10 │ cooldown  │ cooldown  │ ep2:[10s] ep3  │ [ep4]
         │ 10m       │ 10m      │ EXECUTE        │
10:00:20 │ cooldown  │ cooldown  │ ep2            │ ep4:[5s]
         │ 10m       │ 10m      │ WAIT           │ EXECUTE
10:00:30 │ cooldown  │ cooldown  │ EXECUTE        │ cooldown
         │ 10m       │ 10m      │ (ep2 ready)    │ 10s
...      │ ...       │ ...      │ ...            │ ...
```

**Legend:**
- `EXECUTE` — task running
- `WAIT` — queue in cooldown
- `ep2:[10s]` — ep2 available in 10 sec
- `[]` — empty queue

---

## 🔄 Key Multi-Series × Multi-Episodes Points

### 1. Check tasks — sequential

ONE check task runs at a time, even across different domains:
- `executorBusy = true` blocks ALL queues
- Round-robin guarantees fair scheduling

### 2. Download tasks — staggered

Episodes added with `downloadDelay` delay:
```typescript
for (let i = 0; i < episodes.length; i++) {
  const delayMs = i * downloadDelay * 1000;  // 0, 10s, 20s, ...
  scheduler.addTask(queueName, episode, delayMs);
}
```

### 3. Round-robin fairness

Download order (2 series × 2 episodes):
```
ep1 (wetv) → ep3 (iq) → ep2 (wetv) → ep4 (iq)
```

Without round-robin:
```
ep1 → ep2 → ep3 → ep4  # wetv dominates
```

### 4. Cooldown after each task

```typescript
scheduler.markTaskComplete(queueName, cooldownMs);
```

- Check: 10 minutes (checkInterval)
- Download: 10 seconds (downloadDelay)

---

## ⚠️ Important Limitation

**Global executorBusy flag** means:
- Cannot download from different domains in parallel
- Even if `download:wetv` and `download:iq` both have tasks
- Only ONE task runs globally

**Why?** Architecture simplification, avoiding race conditions.

---

## 🔍 Debug Flow

For debugging flow:

```typescript
// Enable debug logs
AppContext.getNotifier().notify(NotificationLevel.DEBUG, '...');

// Get queue statistics
const stats = queueManager.getQueueStats();
console.log(stats);

// Check state
queueManager.hasActiveProcessing();  // true/false
```

---

## 📝 Summary

1. **Scheduler** waits for startTime → triggers QueueManager
2. **QueueManager** creates check queues for each series
3. **UniversalScheduler** round-robin executes check tasks
4. **Handlers** extract episodes → StateManager filters
5. **QueueManager** adds new episodes to download queues
6. **UniversalScheduler** round-robin downloads ep1, ep3, ep2, ep4
7. **DownloadManager** runs yt-dlp → StateManager records

**Total for 2×2:**
- 4 check tasks (sequential)
- 4 download tasks (staggered + round-robin)
- ~40-60 seconds (depends on downloadDelay and speed)
