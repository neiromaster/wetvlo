# wetvlo Documentation

CLI application for automatic downloading of TV series episodes from Chinese video sites (wetv.vip, iq.com, mgtv.com) via yt-dlp.

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Project architecture, modules, layers, dependencies |
| [EXECUTION_FLOW.md](./EXECUTION_FLOW.md) | Detailed execution flow from config to download |
| [MODULES.md](./MODULES.md) | Complete description of all modules with files and functions |

## 🚀 Quick Start

```bash
# Install dependencies
bun install

# Run with default config
bun run start

# Single check and exit
bun run start:once

# Run with custom config
bun run dist/index.js --config ./custom.yaml

# Tests
bun test
```

## 🏗️ Architecture in a Nutshell

```
CLI → App → Scheduler → QueueManager → UniversalScheduler
                              ↓
                         Handlers (episode extraction)
                              ↓
                         DownloadManager (yt-dlp)
                              ↓
                         StateManager (JSON)
```

**Key Features:**
- **Queue-based architecture**: check queues and download queues
- **Round-robin execution**: fair scheduling across domains
- **Sequential processing**: only ONE task executes globally
- **Event-driven**: no polling, timer-based operation

## 📁 Project Structure

```
src/
├── index.ts              # CLI entry point
├── app.ts                # Application orchestration
├── app-context.ts        # Global service locator
├── scheduler/            # Time-based scheduler
├── queue/                # Queues and universal scheduler
├── handlers/             # Domain-specific extractors
├── downloader/           # Download via yt-dlp
├── state/                # JSON persistence
├── config/               # Configuration (4 levels)
├── notifications/        # Console + Telegram
├── types/                # TypeScript types
├── errors/               # Custom errors
└── utils/                # Utilities
```

## 🔄 Main Flow

1. **Configuration**: 4-level merge (defaults → global → domain → series)
2. **Scheduler**: groups series by startTime, waits for scheduled time
3. **QueueManager**: creates check queues for each series
4. **UniversalScheduler**: round-robin task execution
5. **Handlers**: parse HTML, extract episodes
6. **StateManager**: filters already downloaded
7. **DownloadManager**: runs yt-dlp, validates, saves to state

## 🔑 Key Concepts

### Service Locator (AppContext)
Global singleton for accessing config, notifier, state manager:
```typescript
AppContext.getConfig().resolve(url, 'series')
AppContext.getNotifier().notify(NotificationLevel.INFO, 'message')
AppContext.getStateManager().isDownloaded(statePath, seriesName, episodeNumber)
```

### Queue Architecture
Two queues per domain:
- `check:{domain}:{hash}` — new series checks (one queue per series)
- `download:{domain}` — episode downloads (shared per domain)

### Configuration Hierarchy
```yaml
defaults (config-defaults.ts)
  ↓
globalConfigs (config.yaml)
  ↓
domainConfigs (config.yaml)
  ↓
series (config.yaml)  # highest priority
```

## 📖 Additional Resources

- [CLAUDE.md](../CLAUDE.md) - Instructions for Claude Code
- [config.yaml.example](../config.yaml.example) - Configuration example

## 🧪 Tests

```bash
# All tests
bun test

# Specific file
bun test src/scheduler/scheduler.test.ts

# Regression tests (document past bugs)
bun test src/scheduler/scheduler-regression.test.ts
```

Total: **272 tests**, all passing.
