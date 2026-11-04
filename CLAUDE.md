# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun install              # Install dependencies
bun run start            # Run with default config (./config.yaml)
bun run start:once       # Run in single-run mode (check once and exit)
bun run build            # Build to dist/
bun run typecheck        # Type checking
bun run lint             # Linting (Biome + dprint check)
bun run format           # Format code (Biome + dprint fmt)

# Testing
bun test                 # Run all tests
bun test <path>          # Run specific test file

# CLI usage
bun run dist/index.js                    # Run built version
bun run dist/index.js --config ./custom.yaml   # Custom config
bun run dist/index.js --once             # Single-run mode
```

## Architecture Overview

This is a CLI app for downloading TV episodes from Chinese video sites (wetv.vip, iq.com, mgtv.com, youku.tv). yt-dlp is the default/fallback downloader — it handles wetv/iq and mgtv (native MGTV extractor); youku uses a custom downloader (`YoukuDownloader`), routed by DownloadManager via `downloaderRegistry`.

### Flow

1. **CLI** (`src/index.ts`) → **App** (`src/app.ts`) initializes components
2. **Scheduler** waits for `startTime`, then adds series checks to **QueueManager**
3. **QueueManager** uses **UniversalScheduler** to execute tasks sequentially:
   - **Check tasks**: Fetch page, extract episodes via domain handlers
   - **Download tasks**: Execute downloads via **DownloadManager** (yt-dlp default, incl. mgtv via its native extractor; custom downloader for youku)
4. **StateManager** tracks downloaded episodes in JSON to prevent duplicates
5. **Notifier** sends console output + Telegram errors

### Key Components

- **Scheduler** (`src/scheduler/scheduler.ts`): Groups series by `startTime`, waits until scheduled time, triggers QueueManager
- **QueueManager** (`src/queue/queue-manager.ts`): Orchestrates check/download queues, handles retries with exponential backoff
- **UniversalScheduler** (`src/queue/universal-scheduler.ts`): Central executor ensuring only ONE task runs globally, event-driven (no polling)
  - Maintains per-domain queues with cooldowns
  - Round-robin queue selection for fairness
  - Timer-based scheduling (clears timer on scheduling attempt)
- **ConfigRegistry** (`src/config/config-registry.ts`): Pre-merged config registry with resolution (defaults → global → domain → series)
  - Use `registry.resolve(url, 'series')` to get series-level config
  - Use `registry.resolve(url, 'domain')` to get domain-level config
  - Use `registry.resolve(url, 'global')` to get global config
- **DownloadManager** (`src/downloader/download-manager.ts`): Wraps yt-dlp with execa, validates duration/size, supports tempDir
  - **Artifact cleanup**: Automatically cleans up partial files on failed downloads before retry
  - Uses pattern matching `${filenameWithoutExt}.*` to find and remove `.part`, `.tmp`, etc.
  - Cleans before download (removes old artifacts) and on error (removes failed attempt)
- **Firefox cookies** (`src/utils/firefox-cookies.ts`): Reads cookies from a Firefox profile (`cookiesFromBrowser: "firefox:<profile>"`) — copies cookies.sqlite (+wal/shm) to a temp dir and reads it with `node:sqlite`; `readCookieHeaderForUrl()` returns only cookies scoped to the target URL's domain
- **CookieSessionRescue** (`src/utils/firefox-rescue.ts`): Session rescue — on `CookieError`/`TrialContentError` during download with `cookiesFromBrowser` set (handled in QueueManager.executeDownload's retry branch), opens the series page in the Firefox profile, compares the domain's cookies before/after, retries in 10s when changed; 30-min per-domain cooldown
- **StateManager** (`src/state/state-manager.ts`): JSON file persistence, series-grouped structure, dirty-checking for saves
- **EventBus** (`src/events/event-bus.ts`): Typed pub/sub over Emittery; global singleton via `getEventBus()`, also on `AppContext.getEventBus()`. Event types in `src/events/event-types.ts` (categories: app, config, download, health, notification, queue, scheduler, scraping, state). UniversalScheduler and Scheduler emit events (`queue:*`, `scheduler:*`); QueueManager subscribes for monitoring. Deprecated callbacks (`setOnWait`) remain only for tests
- **Handlers** (`src/handlers/`): Domain-specific episode extractors extending `BaseHandler`

### Queue-Based Architecture

The system uses a dual-queue design:
- **Check queues** (`check:{domain}:{hash}`, hash = `md5(url).substring(0, 12)`): Series page scraping tasks (one per series)
- **Download queues** (`download:{domain}`): Episode download tasks

Tasks flow: Check queue → extract episodes → add to Download queue → downloader (yt-dlp or custom) → StateManager

Key behaviors:
- Fully sequential processing: only one task executes globally at a time
- Round-robin queue selection for fairness across domains and task types
- "No episodes" requeues with `checkInterval` delay, up to `count` attempts
- Errors retry with exponential backoff (`initialTimeout * backoffMultiplier^retryCount` ± jitter)
- Priority tasks jump to front of queue (for retries)

### Configuration Hierarchy

Settings merge in priority order:
1. **Series config** (highest) - per-series override
2. **Domain config** - per-domain settings
3. **Global config** - global defaults
4. **Defaults** (lowest) - `src/config/config-defaults.ts`

Example:
```yaml
series:
  - url: "https://wetv.vip/play/abc"
    download:                    # Series-level (highest priority)
      maxRetries: 5

globalConfig:
  download:
    maxRetries: 4                # Global-level (used if not set in series)

# Defaults in code: maxRetries: 3, initialTimeout: 5 (lowest)
```

### Adding New Domain Handlers

1. Extend `BaseHandler` (`src/handlers/base/base-handler.ts`)
2. Implement `getDomain()` and `extractEpisodes()`
3. Register in `src/app.ts` with `handlerRegistry.register()`
4. Handler automatically matches URLs via `supports()` method
5. If yt-dlp can't download for the domain, also add a custom downloader and register it in `src/app.ts` with `downloaderRegistry.register()` (see `YoukuDownloader`) — DownloadManager routes via `downloaderRegistry.getDownloader(url)`

### State File Format

```json
{
  "version": "3.0.0",
  "series": {
    "Series Name": ["01", "02:subs"]
  }
}
```

Series are keyed by series name; values are sorted lists of zero-padded episode-number strings (`"01"`, `"02:subs"`) for proper sorting. `"NN:subs"` marks an episode recorded as subtitles-only (`subsBeforeVideo`); it is not counted by `isDownloaded()` (so the episode keeps being retried) and converts to plain `"NN"` when the video itself later downloads.

### Interactive Mode

When running in scheduled mode with a TTY, interactive mode is enabled:

```bash
bun start
# Press keys to trigger actions:
# [r] Reload configuration
# [c] Clear queues and trigger checks
# [q] Quit
```

Cyrillic key aliases work too: й quits, к reloads configuration, с triggers checks (keypress handler in src/app.ts).

**Config reload behavior**: Pressing `[r]` reloads config.yaml and rebuilds the ConfigRegistry. Only one message "Configuration reloaded successfully" should appear (from app.ts). If you see duplicate messages, check scheduler.ts for redundant logging.

The app handles `SIGINT` (Ctrl+C) and `SIGTERM` for graceful shutdown, allowing current downloads to complete.

## Bun Notes

Bun is the dev toolchain only — **runtime code must stay Node-runnable** (see APIs). Default to Bun for development:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

The published package is a Node CLI: its `bin` (`dist/index.js`, shebang
`#!/usr/bin/env node`) is executed by node in production (mise installs it as an
npm package). **No `bun:*` imports or `Bun.*` APIs in runtime code** — a single
`bun:` import in `src` (outside `*.test.ts`) breaks every production install.
bun modules in tests (`bun:test`, `bun:sqlite` fixtures) are fine.

- `node:sqlite` (`DatabaseSync`) for SQLite. Don't use `better-sqlite3`.
- Node built-ins (`node:fs`, `node:path`, ...) — not `Bun.file` or other Bun globals.
- Don't use `express`, `ioredis`, `pg`, `postgres.js`, or `ws`.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```
