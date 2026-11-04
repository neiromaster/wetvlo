# System Configuration Guide

This document describes the configuration system for wetvlo, which uses a 4-level hierarchy to determine settings for series checks and downloads.

## Configuration Hierarchy

The system resolves configuration settings in the following order of priority (highest to lowest):

1.  **Series Configuration**: Settings from the series entry in `series`.
2.  **Domain Configuration**: Settings from the matching entry in `domainConfigs`.
3.  **Global Configuration**: Settings from `globalConfig`.
4.  **System Defaults**: Hardcoded fallback values (see [Defaults](#defaults)).

A value defined at a higher level overrides values at lower levels. For example, if `download.downloadDelay` is set to 10 in `globalConfig` but 5 in a series entry, the system uses 5 for that series.

Merging is deep: a series entry that sets only `check.count` keeps the domain/global values for every other setting. The resolved configuration is fully merged, so every setting always has a value.

## Configuration File

The app reads a single YAML file, `config.yaml` by default (override with `--config ./custom.yaml`). See `config.example.yaml` for a starting point.

Any string value supports `${VAR_NAME}` environment variable placeholders. They are resolved recursively when the file is loaded; referencing a variable that is not set fails the load.

### Top-Level Structure

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `series` | SeriesConfig[] | yes | List of series to monitor (at least one). |
| `domainConfigs` | DomainConfig[] | no | Per-domain overrides. |
| `globalConfig` | GlobalConfig | no | Global defaults. |

The key is `globalConfig` (singular). A `globalConfigs` key is ignored, but triggers a "Did you mean 'globalConfig'?" warning at load.

### Common Settings

Every level (a series entry, a domain config, or `globalConfig`) accepts the same set of keys:

| Key | Type | Description |
| :--- | :--- | :--- |
| `check` | object | Check behavior (see [Check Settings](#check-settings-check)). |
| `download` | object | Download behavior (see [Download Settings](#download-settings-download)). |
| `subLangs` | string[] | List of subtitle languages to download. |
| `cookiesFromBrowser` | string | Firefox profile cookie spec: `"firefox:<profile>"` (see [Cookies and Firefox](#cookies-and-firefox)). |
| `stateFile` | string | Path to the state file. |
| `notifications` | object | Console notification settings (see [Notifications](#notifications)). |
| `telegram` | object | Telegram error notifications (see [Notifications](#notifications)). |

Note that `subLangs` is a top-level common key — it does not live under `download`.

## Series Configuration

A series entry identifies what to monitor and when to start checking it:

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | string | yes | Series name (used in state tracking and log/notification output). |
| `url` | string | yes | Series page URL (e.g. `https://wetv.vip/play/abc`). |
| `startTime` | string | no | Daily check start time in `HH:MM` format (e.g. `"20:00"`). |
| `cron` | string | no | Cron expression for scheduling. Takes precedence over `startTime` when both are set. |

Plus all [common settings](#common-settings). Series entries without `startTime`/`cron` can be triggered manually (interactive mode key `[c]`).

## Domain Configuration

A domain config overrides settings for all series on one site:

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `domain` | string | yes | Hostname to match (see below). |

Plus all [common settings](#common-settings).

The `domain` value is matched against the **exact URL hostname** of series URLs. A series URL of `https://www.iq.com/play/abc` has the hostname `www.iq.com`, so it matches `domain: "www.iq.com"` — not `"iq.com"` and not `"iqiyi.com"`. A series whose hostname has no matching domain config falls back to the global config.

## Check Settings (`check`)

Controls how the system checks for new episodes.

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `count` | number | 3 | Number of check attempts per session. When no new episodes are found, the check is requeued up to `count` times before giving up. Must be > 0. |
| `checkInterval` | number | 600 | Time in seconds between checks. Must be > 0. |
| `downloadTypes` | string[] | `['available']` | Types of episodes to download (see [Episode Types](#episode-types)). |

## Download Settings (`download`)

Controls how the system downloads episodes.

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `downloadDir` | string | `./downloads` | Directory to save downloaded episodes. |
| `tempDir` | string | `./downloads` | Directory for temporary files. Partial files (`.part`, `.tmp`, ...) are cleaned up here before a retry and on failure. |
| `downloadDelay` | number | 10 | Delay in seconds between downloads (per-domain queue cooldown). Must be >= 0. |
| `maxRetries` | number | 3 | Maximum number of retry attempts for failed downloads. Must be >= 0. |
| `initialTimeout` | number | 5 | Initial retry delay in seconds (base of the backoff calculation). Must be > 0. |
| `backoffMultiplier` | number | 2 | Multiplier for exponential backoff: `initialTimeout * backoffMultiplier^retryCount` ± jitter. Must be >= 1. |
| `jitterPercentage` | number | 10 | Jitter percentage (0-100) applied to retry delays to avoid thundering herd. |
| `minDuration` | number | 0 | Minimum video duration in seconds to consider a download valid (0 disables the check). Must be >= 0. |
| `subsBeforeVideo` | boolean | false | Download subtitles for locked/TVOD episodes now and fetch the video once it becomes available. Attempting TVOD episodes additionally requires `express` in `check.downloadTypes`. |

## Episode Types

`check.downloadTypes` accepts the following values:

| Value | Meaning |
| :--- | :--- |
| `available` | Free episodes. |
| `vip` | VIP episodes. |
| `svip` | SVIP episodes. |
| `preview` | Preview episodes. |
| `locked` | Locked episodes. |
| `teaser` | Teaser/trailer episodes. |
| `express` | Express (TVOD / early-access) episodes. Required for `download.subsBeforeVideo` to attempt TVOD episodes. |

## Cookies and Firefox

`cookiesFromBrowser` takes a Firefox profile spec in the form `"firefox:<profile>"` — only Firefox is supported (its cookie database is plaintext SQLite). The value may also be a `${VAR_NAME}` placeholder, resolved before the spec is parsed.

The profile name is matched against directories in `%APPDATA%\Mozilla\Firefox\Profiles` (and the Microsoft Store packaged install under `%LOCALAPPDATA%`) by full directory name or by the suffix after the dot: `abc123.default-release` matches `"default-release"`. When several directories match, the lexically first one is used and a warning is logged.

The profile cookies are used for:

-   Page checks: a `Cookie` header is built from the profile for the series URL's host.
-   MGTV and Youku API calls.

**yt-dlp does not receive cookies from wetvlo.** To give yt-dlp cookies, put `--cookies-from-browser firefox:<profile>` into `yt-dlp.conf` in the working directory.

### Session Rescue

Session rescue has no configuration keys — it activates automatically when `cookiesFromBrowser` is set. When a download fails with a session or trial error (`CookieError` / `TrialContentError`), wetvlo:

1.  Opens the series page in the configured Firefox profile. If Firefox is already running with that profile, this is a new tab in your own browser; otherwise wetvlo launches Firefox itself.
2.  Lets the site refresh its session cookies, then closes the browser it launched (a delegated tab in a running Firefox is left open).
3.  Compares the domain's cookies before and after the visit. If they changed, the download is retried after 10 seconds instead of waiting for the full backoff delay.

At most one rescue is attempted per domain per 30 minutes. If the cookies did not change, wetvlo warns that you may need to log back in within Firefox.

## State

`stateFile` (default `wetvlo-state.json`) is the JSON file where wetvlo tracks downloaded episodes per series to prevent duplicates. It is created automatically; series are keyed by name and hold sorted, zero-padded episode numbers.

## Notifications

Notification levels, from least to most severe: `debug`, `info`, `success`, `highlight`, `warning`, `error`.

### Console

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `notifications.consoleMinLevel` | string | `info` | Minimum level for console output. |

### Telegram

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `telegram.botToken` | string | — | Telegram bot token from @BotFather. |
| `telegram.chatId` | string | — | Telegram chat ID (e.g. from @userinfobot). |
| `telegram.minLevel` | string | `error` | Minimum level for Telegram notifications. |

Telegram is disabled by omitting the `telegram` section entirely. `botToken` and `chatId` typically use `${VAR}` placeholders so secrets stay out of the config file:

```yaml
globalConfig:
  telegram:
    botToken: "${TELEGRAM_BOT_TOKEN}"
    chatId: "${TELEGRAM_CHAT_ID}"
    minLevel: "error"
```

## Defaults

Hardcoded fallback values (lowest priority), defined in `src/config/config-defaults.ts`:

| Setting | Default |
| :--- | :--- |
| `stateFile` | `wetvlo-state.json` |
| `cookiesFromBrowser` | unset |
| `check.count` | 3 |
| `check.checkInterval` | 600 |
| `check.downloadTypes` | `['available']` |
| `download.downloadDir` | `./downloads` |
| `download.tempDir` | `./downloads` |
| `download.downloadDelay` | 10 |
| `download.maxRetries` | 3 |
| `download.initialTimeout` | 5 |
| `download.backoffMultiplier` | 2 |
| `download.jitterPercentage` | 10 |
| `download.minDuration` | 0 |
| `download.subsBeforeVideo` | false |
| `notifications.consoleMinLevel` | `info` |
| `telegram.minLevel` | `error` |

## Removed (Legacy) Keys

The following keys are no longer supported: `cookieFile`, `cookieRefreshBrowser`, `playwrightHeadless`, `browser`.

The config still loads, but each occurrence produces a `'<key>' is no longer supported` warning. Legacy keys are detected at the top level, inside `series[]`, inside `domainConfigs[]` and inside `globalConfig`. For `cookieFile` the warning hints at the replacement: use `cookiesFromBrowser: "firefox:<profile>"` (and put `--cookies-from-browser firefox:<profile>` into `yt-dlp.conf` in the working directory). For the other keys the hint is simply to remove them — they have no effect anymore.

## Validation Warnings

Besides Zod schema validation (key names and types come from `src/config/config-schema.ts`), the loader detects common mistakes at startup and prints them as configuration warnings:

-   `globalConfigs` found — did you mean `globalConfig`?
-   `downloadDir` placed directly under `globalConfig` or under a `domainConfigs` entry, or `tempDir` directly under `globalConfig`, instead of under their `download` section (a misplaced `tempDir` under a `domainConfigs` entry is not warned about).
-   `count` / `checkInterval` placed directly under `globalConfig` instead of under `check`.
-   Removed legacy keys (see above).

At load time, the Zod schema additionally requires `check.count` and `check.checkInterval` > 0, `download.downloadDelay` and `download.minDuration` >= 0, `download.maxRetries` a non-negative integer, `download.initialTimeout` and `download.backoffMultiplier` > 0, and `download.jitterPercentage` an integer in 0-100. After merging, resolved values are validated again (`check.count` >= 1, negative `checkInterval`/`downloadDelay`/`maxRetries`/`initialTimeout`/`minDuration` rejected, `backoffMultiplier` >= 1). Violations throw an error to prevent undefined behavior.

## Implementation Details

The configuration logic is centralized in the `ConfigRegistry` class (`src/config/config-registry.ts`).

### Resolution Process

The registry pre-merges all levels at construction time (`defaults → global → domain → series`) and stores the results keyed by URL, domain and level:

1.  `extractDomain()` takes the hostname from a series URL.
2.  The matching `domain:<hostname>` config is looked up; without one, the series falls back to global.
3.  The series entry is merged on top, and the result is validated.

### API

```typescript
const registry = new ConfigRegistry(config);

registry.resolve(url); // Full series-level resolution (default)
registry.resolve(url, 'domain'); // Domain-level resolution (falls back to global)
registry.resolve(url, 'global'); // Global-level resolution

registry.listSeriesUrls(); // All configured series URLs
registry.listDomains(); // All hostnames seen in series URLs
```

## Example

```yaml
series:
  - name: "My WeTV Show"
    url: "https://wetv.vip/play/your-series-id"
    startTime: "20:00"
    check:
      count: 5
    download:
      maxRetries: 5

  - name: "My iQIYI Show"
    url: "https://www.iq.com/play/your-series-id"
    cron: "0 21 * * *"
    # No check/download sections — uses domain/global settings

domainConfigs:
  - domain: "www.iq.com"
    check:
      checkInterval: 120

globalConfig:
  check:
    count: 3
    checkInterval: 600
    downloadTypes:
      - available

  download:
    downloadDir: "./downloads"
    tempDir: "./downloads"
    downloadDelay: 10

  subLangs:
    - "en"

  cookiesFromBrowser: "firefox:default-release"

  notifications:
    consoleMinLevel: "info"

  telegram:
    botToken: "${TELEGRAM_BOT_TOKEN}"
    chatId: "${TELEGRAM_CHAT_ID}"
    minLevel: "error"
```
