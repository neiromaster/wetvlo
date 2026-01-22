# wetvlo

CLI application for monitoring and downloading TV series episodes from Chinese video sites (wetv.vip, iq.com).

## Features

- **CLI Application**: Runs in terminal with colored console output
- **YAML Configuration**: Simple configuration file for series to monitor
- **Multiple Domain Handlers**: Supports wetv.vip and iq.com with extensible handler system
- **Automatic Download**: Downloads new episodes via yt-dlp when detected
- **State Tracking**: JSON state file prevents duplicate downloads
- **Smart Notifications**: Console output for normal operations, Telegram for errors only
- **Cookie Support**: Extract cookies from browser for authentication
- **Scheduled Checks**: Check for new episodes at specified times with configurable intervals

## Prerequisites

- [Bun](https://bun.sh/) - JavaScript runtime
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Video downloader
  - macOS: `brew install yt-dlp`
  - Linux: `pip install yt-dlp`
  - Windows: `winget install yt-dlp`

## Installation

```bash
bun install
```

## Configuration

Create a `config.yaml` file in the project root:

```yaml
# Series to monitor
series:
  - url: "https://wetv.vip/play/abc123"
    startTime: "20:00"  # Time to start checking (HH:MM format)
    checks: 10          # Number of times to check
    interval: 300       # Seconds between checks

  - url: "https://www.iq.com/play/xyz789"
    startTime: "21:00"
    checks: 5
    interval: 600

# Optional: Telegram notifications for errors only
telegram:
  botToken: "${TELEGRAM_BOT_TOKEN}"  # Supports ${VAR} env variable syntax
  chatId: "${TELEGRAM_CHAT_ID}"

# Download directory
downloadDir: "./downloads"

# State file path (auto-created)
stateFile: "./wetvlo-state.json"

# Browser for cookie extraction
browser: "chrome"  # Options: chrome, firefox, safari, chromium, edge

# Optional: Manual cookie file path (Netscape format)
# cookieFile: "./cookies.txt"
```

### Environment Variables

You can use `${VAR_NAME}` syntax in config.yaml to reference environment variables:

```bash
export TELEGRAM_BOT_TOKEN="your_bot_token"
export TELEGRAM_CHAT_ID="your_chat_id"
```

## Cookie Setup

To access VIP content, you'll need to provide cookies:

### Option 1: Export cookies manually (Recommended)

1. Install a browser extension like "Get cookies.txt LOCALLY"
2. Go to wetv.vip or iq.com and log in
3. Export cookies to a file (Netscape format)
4. Set `cookieFile` in config.yaml

### Option 2: Browser extraction (Coming soon)

Automatic browser cookie extraction will be added in a future version.

## Usage

### Build and run

```bash
# Build the project
bun run build

# Run with default config (./config.yaml)
bun run dist/index.js

# Run with custom config
bun run dist/index.js /path/to/config.yaml
```

### How it works

1. At the specified `startTime`, the scheduler starts checking each series
2. For each series URL:
   - Fetches the page using configured cookies
   - Extracts episode list (number, URL, type)
   - Identifies new "available" episodes not yet downloaded
   - Downloads each new episode using yt-dlp
3. Repeats `checks` times with `interval` seconds between checks
4. Saves download history to state file (prevents duplicates)

### Graceful Shutdown

Press `Ctrl+C` to stop the scheduler. The application will:
- Stop all running tasks
- Save current state to disk
- Exit cleanly

## Development

```bash
# Type checking
bun run typecheck

# Linting
bun run lint

# Formatting
bun run format
```

## Architecture

```
src/
├── index.ts              # CLI entry point
├── types/                # TypeScript types
├── config/               # Configuration loading and validation
├── handlers/             # Domain-specific episode extractors
│   ├── base/            # Base handler class
│   └── impl/            # wetv.vip and iq.com implementations
├── scheduler/            # Task scheduling and execution
├── downloader/           # yt-dlp wrapper
├── state/                # JSON state management
├── notifications/        # Console + Telegram notifications
├── utils/                # Utilities (logger, time, URL, cookies)
└── errors/               # Custom error classes
```

## State File Format

The `wetvlo-state.json` file tracks downloaded episodes:

```json
{
  "version": "1.0.0",
  "downloadedEpisodes": [
    {
      "number": 1,
      "url": "https://...",
      "downloadedAt": "2025-01-23T20:05:00+08:00",
      "seriesUrl": "https://...",
      "filename": "series-ep01.mp4"
    }
  ],
  "lastUpdated": "2025-01-23T20:10:00+08:00"
}
```

## Supported Sites

- **wetv.vip** (WeTV International)
- **iq.com** (iQIYI International)

More sites can be added by implementing new handlers in `src/handlers/impl/`.

## Troubleshooting

### yt-dlp not found

Install yt-dlp using your package manager (see Prerequisites).

### Cookie errors

Make sure you're logged into the site in your browser before exporting cookies.

### No episodes found

The site may have changed its HTML structure. Open an issue if this happens.

### Telegram notifications not working

Check that:
- Bot token is correct
- Bot is added to the chat/group
- Bot has permission to send messages

## License

MIT
