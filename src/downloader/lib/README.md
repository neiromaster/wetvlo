# YtdlpWrapper Usage Examples

This library provides a low-level, flexible wrapper around yt-dlp that accepts arbitrary CLI arguments.

## Basic Usage

```typescript
import { YtdlpWrapper } from './lib/ytdlp-wrapper.js';

const wrapper = new YtdlpWrapper();

// Basic download
const result = await wrapper.download(
  'https://example.com/video',
  'MyVideo',
  './downloads',
  {
    onProgress: (msg) => console.log(msg),
    onLog: (msg) => console.log(msg),
  }
);

console.log('Downloaded:', result.filename);
console.log('All files:', result.allFiles);
```

## Using Presets

```typescript
import { YtdlpWrapper, YtdlpPresets } from './lib/index.js';

const wrapper = new YtdlpWrapper();
const presets = new YtdlpPresets(wrapper);

// Download with subtitles (defaults to ['en', 'ru'])
await presets.downloadWithSubs(url, 'Video', './downloads');

// Download with custom subtitle languages
await presets.downloadWithSubs(url, 'Video', './downloads', {
  subLangs: ['en', 'ru', 'zh-Hans']
});

// Download only subtitles
await presets.downloadSubtitlesOnly(url, 'subs', './downloads', {
  subLangs: ['en', 'ru']
});

// Download with embedded subtitles
await presets.downloadWithEmbeddedSubs(url, 'Video', './downloads', {
  subLangs: ['en', 'ru']
});

// Custom format selection
await presets.downloadWithFormat(url, 'Video', './downloads', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]');
```

## Subtitle Downloads

### Via subLangs Option (Recommended)

```typescript
// Automatically adds --write-subs and --sub-lang arguments
await wrapper.download(url, 'output', './downloads', {
  subLangs: ['en', 'ru', 'zh-Hans']
});
```

### Via Custom Arguments

```typescript
// Manual control over subtitle arguments
await wrapper.download(url, 'output', './downloads', {
  args: [
    '--write-subs',
    '--sub-lang', 'en,ru',
    '--embed-subs',
    '--merge-output-format', 'mp4'
  ]
});
```

## Cookie Files

```typescript
await wrapper.download(url, 'output', './downloads', {
  cookieFile: '/path/to/cookies.txt'
});
```

## Progress Tracking

```typescript
await wrapper.download(url, 'output', './downloads', {
  onProgress: (progress) => {
    // Progress updates: "[download] 45.2% of 145.41MiB at 563.37KiB/s ETA 03:34"
    process.stdout.write('\r' + progress);
  },
  onLog: (message) => {
    // Log messages: "[info] Downloading video...", "[ffmpeg] Merging formats..."
    console.log(message);
  }
});
```

## Download Result

```typescript
type YtdlpDownloadResult = {
  filename: string;      // Main file path (e.g., "./downloads/MyVideo.mp4")
  allFiles: string[];    // All files (video, subtitles, etc.)
};
```

## Configuration (config.yaml)

The `subLangs` option can be configured at multiple levels:

```yaml
# Global default for all series
globalConfig:
  subLangs:
    - en
    - ru

# Domain-specific override
domainConfigs:
  - domain: wetv.vip
    subLangs:
      - zh-Hans
      - en

# Series-specific override
series:
  - url: "https://wetv.vip/play/abc"
    name: "My Series"
    subLangs:
      - en
      - ru
      - zh-Hans
```

Priority: Series > Domain > Global

