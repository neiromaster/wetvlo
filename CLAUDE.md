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

This is a CLI app for downloading TV episodes from Chinese video sites (wetv.vip, iq.com) using yt-dlp.

### Flow

1. **CLI** (`src/index.ts`) → **App** (`src/app.ts`) initializes components
2. **Scheduler** waits for `startTime`, then adds series checks to **QueueManager**
3. **QueueManager** uses **UniversalScheduler** to execute tasks sequentially:
   - **Check tasks**: Fetch page, extract episodes via domain handlers
   - **Download tasks**: Execute yt-dlp via **DownloadManager**
4. **StateManager** tracks downloaded episodes in JSON to prevent duplicates
5. **Notifier** sends console output + Telegram errors

### Key Components

- **Scheduler** (`src/scheduler/scheduler.ts`): Groups series by `startTime`, waits until scheduled time, triggers QueueManager
- **QueueManager** (`src/queue/queue-manager.ts`): Orchestrates check/download queues, handles retries with exponential backoff
- **UniversalScheduler** (`src/queue/universal-scheduler.ts`): Central executor ensuring only ONE task runs globally, event-driven (no polling)
  - Maintains per-domain queues with cooldowns
  - Round-robin queue selection for fairness
  - Timer-based scheduling (clears timer on scheduling attempt)
- **ConfigResolver** (`src/config/config-resolver.ts`): Merges config hierarchy (series > domain > global > defaults)
- **DownloadManager** (`src/downloader/download-manager.ts`): Wraps yt-dlp with execa, validates duration/size, supports tempDir
- **StateManager** (`src/state/state-manager.ts`): JSON file persistence, series-grouped structure, dirty-checking for saves
- **Handlers** (`src/handlers/`): Domain-specific episode extractors extending `BaseHandler`

### Queue-Based Architecture

The system uses a dual-queue design:
- **Check queues** (`check:{domain}`): Series page scraping tasks
- **Download queues** (`download:{domain}`): Episode download tasks

Tasks flow: Check queue → extract episodes → add to Download queue → yt-dlp → StateManager

Key behaviors:
- Per-domain sequential processing (only one check OR download per domain at a time)
- Domain-based parallelism (wetv.vip and iq.com can process simultaneously)
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

globalConfigs:
  download:
    maxRetries: 3                # Global-level (used if not set in series)

# Defaults in code: maxRetries: 2 (lowest)
```

### Adding New Domain Handlers

1. Extend `BaseHandler` (`src/handlers/base/base-handler.ts`)
2. Implement `getDomain()` and `extractEpisodes()`
3. Register in `src/app.ts` with `handlerRegistry.register()`
4. Handler automatically matches URLs via `supports()` method

### State File Format

```json
{
  "version": "2.0.0",
  "series": {
    "https://wetv.vip/play/abc": {
      "name": "Series Name",
      "episodes": {
        "01": { "url": "...", "filename": "...", "downloadedAt": "...", "size": 12345 },
        "02": { ... }
      }
    }
  },
  "lastUpdated": "2025-01-23T20:10:00+08:00"
}
```

Episode keys are zero-padded strings (`"01"`, `"02"`) for proper sorting.

## Bun Notes

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```
