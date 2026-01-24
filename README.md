# wetvlo

**wetvlo** is a powerful CLI application for automatically monitoring and downloading TV series episodes from popular Asian streaming platforms (WeTV, iQIYI).

## 🚀 Features

*   **Automatic Monitoring**: Checks for new episodes at scheduled times.
*   **Smart Queue**: Sequential downloading and checking to prevent IP bans and ensure stability.
*   **Platform Support**: Built-in support for WeTV and iQIYI.
*   **Reliability**: Retry system with exponential backoff for network errors.
*   **Notifications**: Telegram integration for error alerts.
*   **Flexible Configuration**: Per-series, per-domain, or global settings.
*   **History**: Tracks downloaded episodes to prevent duplicates.

## 📋 Requirements

*   [Bun](https://bun.sh/) (Runtime)
*   [yt-dlp](https://github.com/yt-dlp/yt-dlp) (must be installed and available in PATH)

## 🛠 Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/wetvlo.git
    cd wetvlo
    ```

2.  Install dependencies:
    ```bash
    bun install
    ```

## ⚙️ Configuration

1.  Create a configuration file by copying the example:
    ```bash
    cp config.example.yaml config.yaml
    ```

2.  Edit `config.yaml` to suit your needs. Main sections:

    *   **series**: List of series to monitor (highest priority).
    *   **domainConfigs**: Settings for specific sites (e.g., delays for WeTV).
    *   **globalConfigs**: Global default settings.
    *   **telegram**: Bot settings for notifications (optional).

    Example series configuration:
    ```yaml
    series:
      - name: "Series Name"
        url: "https://wetv.vip/play/series-id"
        startTime: "20:00" # Check start time (HH:MM)
        download:
          maxRetries: 5 # Number of retry attempts on failure
    ```

## ▶️ Usage

### Development Mode
Run with default configuration (`./config.yaml`):
```bash
bun start
```

Run in single-pass mode (check once and exit without waiting for schedule):
```bash
bun start:once
```

### Build and Run (Production)
Build the project into a single file:
```bash
bun run build
```

Run the built file:
```bash
bun dist/index.js
# or with a custom config
bun dist/index.js --config ./my-config.yaml
```

## 🧪 Development

### Testing
Run all tests:
```bash
bun test
```

### Linting and Formatting
Check code style:
```bash
bun run lint
```

Format code:
```bash
bun run format
```

## 🏗 Architecture

The application is built on a task queue (`QueueManager`) that manages update checks and downloads.
*   **Scheduler**: Triggers check tasks according to schedule.
*   **Handlers**: Modules for parsing specific site pages (in `src/handlers`).
*   **DownloadManager**: Wrapper around `yt-dlp` for downloading videos.
*   **StateManager**: Persists progress in `downloads_state.json`.

## 📝 License

MIT
