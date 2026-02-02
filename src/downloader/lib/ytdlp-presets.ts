import type { YtdlpWrapper, YtdlpWrapperOptions } from './ytdlp-wrapper.js';

/**
 * Preset configurations for common yt-dlp scenarios
 */
export class YtdlpPresets {
  constructor(private wrapper: YtdlpWrapper) {}

  /**
   * Download video only (no extras)
   */
  async downloadVideo(url: string, outputName: string, dir: string, options?: YtdlpWrapperOptions) {
    return this.wrapper.download(url, outputName, dir, options);
  }

  /**
   * Download video with subtitles
   * If options.subLangs is provided, uses it.
   * Existing args are preserved and combined with subtitle args.
   */
  async downloadWithSubs(url: string, outputName: string, dir: string, options?: YtdlpWrapperOptions) {
    const existingArgs = options?.args || [];
    const subLangs = options?.subLangs;

    return this.wrapper.download(url, outputName, dir, {
      ...options,
      args: [...existingArgs],
      subLangs,
    });
  }

  /**
   * Download only subtitles (skip video)
   * If options.subLangs is provided, uses it.
   * Existing args are preserved and combined with subtitle args.
   */
  async downloadSubtitlesOnly(url: string, outputName: string, dir: string, options?: YtdlpWrapperOptions) {
    const existingArgs = options?.args || [];
    const subLangs = options?.subLangs;

    return this.wrapper.download(url, outputName, dir, {
      ...options,
      args: ['--skip-download', ...existingArgs],
      subLangs,
    });
  }

  /**
   * Download with embedded subtitles
   * If options.subLangs is provided, uses it.
   * Existing args are preserved and combined with subtitle args.
   */
  async downloadWithEmbeddedSubs(url: string, outputName: string, dir: string, options?: YtdlpWrapperOptions) {
    const existingArgs = options?.args || [];
    const subLangs = options?.subLangs;

    return this.wrapper.download(url, outputName, dir, {
      ...options,
      args: ['--embed-subs', '--merge-output-format', 'mp4', ...existingArgs],
      subLangs,
    });
  }

  /**
   * Download with custom format selection
   */
  async downloadWithFormat(
    url: string,
    outputName: string,
    dir: string,
    format: string,
    options?: YtdlpWrapperOptions,
  ) {
    const existingArgs = options?.args || [];
    return this.wrapper.download(url, outputName, dir, {
      ...options,
      args: ['-f', format, ...existingArgs],
    });
  }
}
