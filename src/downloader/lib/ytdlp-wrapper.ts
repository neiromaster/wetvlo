import * as fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

export type YtdlpWrapperOptions = {
  /** Additional yt-dlp CLI arguments (flexible - any yt-dlp args) */
  args?: string[];
  /** Path to cookie file (Netscape format) */
  cookieFile?: string;
  /** List of subtitle languages to download (e.g., ['en', 'ru']) */
  subLangs?: string[];
  /** Callback for progress updates */
  onProgress?: (progress: string) => void;
  /** Callback for log messages */
  onLog?: (message: string) => void;
};

export type YtdlpDownloadResult = {
  /** Main file path */
  filename: string;
  /** All downloaded/generated files */
  allFiles: string[];
};

/**
 * Low-level wrapper for yt-dlp CLI
 * Provides flexible interface for running yt-dlp with arbitrary arguments
 */
export class YtdlpWrapper {
  /**
   * Download using yt-dlp with custom arguments
   *
   * @param url - Video URL
   * @param outputName - Output filename without extension (for -o template)
   * @param dir - Target directory
   * @param options - Wrapper options
   * @returns Download result with filenames
   */
  async download(
    url: string,
    outputName: string,
    dir: string,
    options: YtdlpWrapperOptions = {},
  ): Promise<YtdlpDownloadResult> {
    const { args = [], cookieFile, subLangs, onProgress, onLog } = options;

    // Build output template
    const outputTemplate = join(dir, `${outputName}.%(ext)s`);

    // Ensure directory exists
    await fsPromises.mkdir(dir, { recursive: true });

    // Build command arguments
    const cmdArgs = ['--no-warnings', '--newline', '-o', outputTemplate];

    // Add cookie file if provided
    if (cookieFile) {
      cmdArgs.unshift('--cookies', cookieFile);
    }

    // Add subtitle arguments if subLangs is provided
    if (subLangs && subLangs.length > 0) {
      cmdArgs.push('--write-subs', '--sub-lang', subLangs.join(','));
    }

    // Add user-provided args (flexible - can override defaults if needed)
    cmdArgs.push(...args);

    // Add URL at the end (unless it's already in args)
    if (!args.some((arg) => arg === url)) {
      cmdArgs.push(url);
    }

    let filename: string | null = null;
    const allFiles: Set<string> = new Set();
    const outputBuffer: string[] = [];

    try {
      const subprocess = execa('yt-dlp', cmdArgs, { all: true });

      if (subprocess.all) {
        for await (const line of subprocess.all) {
          const text = line.toString().trim();
          if (!text) continue;

          outputBuffer.push(text);

          // Parse output (same logic as current YtDlpDownloader)
          const destMatch = text.match(/\[download\] Destination:\s*(.+)/);
          if (destMatch) {
            filename = destMatch[1];
            if (filename) allFiles.add(filename);
          }

          const subMatch = text.match(/\[info\] Writing video subtitles to:\s*(.+)/);
          if (subMatch?.[1]) {
            allFiles.add(subMatch[1]);
          }

          const mergeMatch = text.match(/\[merge\] Merging formats into "(.*)"/);
          if (mergeMatch) {
            filename = mergeMatch[1];
            if (filename) allFiles.add(filename);
          }

          // Status messages
          if (
            text.startsWith('[info]') ||
            text.startsWith('[ffmpeg]') ||
            text.startsWith('[merge]') ||
            text.startsWith('[ExtractAudio]') ||
            text.startsWith('[Metadata]') ||
            text.startsWith('[Thumbnails]')
          ) {
            onLog?.(text);
            continue;
          }

          // Progress lines
          if (text.startsWith('[download]')) {
            const progressMatch = text.match(
              /\[download\]\s+(\d+\.?\d*)%\s+of\s+~?\s*([\d.]+\w+)\s+at\s+~?\s*([\d.]+\w+\/s)\s+ETA\s+(\S+)/,
            );

            if (progressMatch) {
              const [, percentage, totalSize, speed, eta] = progressMatch;
              onProgress?.(`[download] ${percentage}% of ${totalSize} at ${speed} ETA ${eta}`);
            } else {
              onLog?.(text);
            }
            continue;
          }

          onLog?.(text);
        }
      }

      await subprocess;

      if (!filename) {
        throw new Error('Could not determine downloaded filename from output');
      }

      return {
        filename,
        allFiles: Array.from(allFiles),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const fullLog = outputBuffer.join('\n');
      throw new Error(`yt-dlp failed: ${errorMsg}\n\nLog output:\n${fullLog}`);
    }
  }

  /**
   * Check if yt-dlp is installed
   */
  static async checkInstalled(): Promise<boolean> {
    try {
      await execa('yt-dlp', ['--version']);
      return true;
    } catch {
      return false;
    }
  }
}
