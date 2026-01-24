# System Configuration Guide

This document describes the configuration system for Wetvlo, which uses a 4-level hierarchy to determine settings for series checks and downloads.

## Configuration Hierarchy

The system resolves configuration settings in the following order of priority (highest to lowest):

1.  **Series Configuration**: Specific settings for a single series (e.g., from `series.yaml`).
2.  **Domain Configuration**: Settings for a specific domain (e.g., `wetv.vip`, `iq.com`).
3.  **Global Configuration**: Default settings for all series/domains.
4.  **System Defaults**: Hardcoded fallback values.

A value defined at a higher level overrides values at lower levels. For example, if `downloadDelay` is set to 5 in Global Config but 2 in a Series Config, the system will use 2.

## Configuration Structure

The configuration is divided into two main sections: `check` and `download`.

### Check Settings (`check`)

Controls how the system checks for new episodes.

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `count` | number | 1 | Number of checks to perform before giving up. Must be >= 1. |
| `checkInterval` | number | 1800 | Time in seconds between checks. Must be >= 0. |
| `downloadTypes` | string[] | `['available', 'vip']` | Types of episodes to download (e.g. `available`, `vip`). |

### Download Settings (`download`)

Controls how the system downloads episodes.

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `downloadDir` | string | `downloads` | Directory to save downloaded files. |
| `downloadDelay` | number | 2 | Delay in seconds between downloads to avoid rate limiting. Must be >= 0. |
| `maxRetries` | number | 3 | Maximum number of retry attempts for failed downloads. Must be >= 0. |
| `initialTimeout` | number | 5 | Initial timeout in seconds for backoff calculation. Must be >= 0. |
| `backoffMultiplier` | number | 1.5 | Multiplier for exponential backoff. Must be >= 1. |
| `jitterPercentage` | number | 20 | Jitter percentage (0-100) for retries to avoid thundering herd. |
| `minDuration` | number | 300 | Minimum video duration in seconds to consider valid. Must be >= 0. |

## Implementation Details

The configuration logic is centralized in the `ConfigResolver` class.

### Resolution Process

When a series is processed:
1.  The `ConfigResolver` extracts the domain from the series URL.
2.  It looks up the corresponding `DomainConfig`.
3.  It merges the Series Config, Domain Config, Global Config, and System Defaults.
4.  It returns a `ResolvedSeriesConfig` object where all fields are guaranteed to be present (non-nullable).

### Validation

The system strictly validates configuration values during resolution. If any value violates the rules (e.g., negative interval), the system throws an error to prevent undefined behavior.

## Example Usage

```typescript
// Initializing the resolver
const resolver = new ConfigResolver(domainConfigs, globalConfigs);

// Resolving config for a series
const seriesConfig = {
  url: 'https://wetv.vip/play/123',
  name: 'My Series',
  check: { count: 5 } // Override count
};

const resolved = resolver.resolve(seriesConfig);

console.log(resolved.check.count); // 5 (from series)
console.log(resolved.check.checkInterval); // 1800 (from default/global)
```
