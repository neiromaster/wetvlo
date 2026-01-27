import * as fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import type { Episode } from '../../types/episode.types';
import { BaseDownloader } from '../base-downloader';
import type { DownloaderOptions, DownloadResult } from '../types';

export class YtDlpDownloader extends BaseDownloader {
  getName(): string {
    return 'yt-dlp';
  }

  supports(_url: string): boolean {
    return true; // Default downloader supports everything (or tries to)
  }

  async download(
    episode: Episode,
    dir: string,
    filenameWithoutExt: string,
    options?: DownloaderOptions,
  ): Promise<DownloadResult> {
    const outputTemplate = join(dir, `${filenameWithoutExt}.%(ext)s`);

    // Ensure directory exists
    await fsPromises.mkdir(dir, { recursive: true });

    const args = ['--no-warnings', '--newline', '-o', outputTemplate, episode.url];

    if (options?.cookieFile) {
      args.unshift('--cookies', options.cookieFile);
    }

    let filename: string | null = null;
    const allFiles: Set<string> = new Set();
    const outputBuffer: string[] = [];

    try {
      const subprocess = execa('yt-dlp', args, { all: true });

      if (subprocess.all) {
        for await (const line of subprocess.all) {
          const text = line.toString().trim();
          if (!text) continue;

          // Buffer all output for error debugging
          outputBuffer.push(text);

          // Capture filename from "[download] Destination: ..." line
          const destMatch = text.match(/\[download\] Destination:\s*(.+)/);
          if (destMatch) {
            filename = destMatch[1];
            if (filename) allFiles.add(filename);
          }

          // Capture subtitles from "[info] Writing video subtitles to: ..."
          const subMatch = text.match(/\[info\] Writing video subtitles to:\s*(.+)/);
          if (subMatch?.[1]) {
            allFiles.add(subMatch[1]);
          }

          // Capture merged file from "[merge] Merging formats into "..."
          const mergeMatch = text.match(/\[merge\] Merging formats into "(.*)"/);
          if (mergeMatch) {
            filename = mergeMatch[1];
            if (filename) allFiles.add(filename);
          }

          // Status messages: [info], [ffmpeg], [merge] - check FIRST
          if (
            text.startsWith('[info]') ||
            text.startsWith('[ffmpeg]') ||
            text.startsWith('[merge]') ||
            text.startsWith('[ExtractAudio]') ||
            text.startsWith('[Metadata]') ||
            text.startsWith('[Thumbnails]')
          ) {
            options?.onLog?.(text);
            continue;
          }

          // Progress lines: [download] ...
          if (text.startsWith('[download]')) {
            // Match: [download]  23.8% of ~ 145.41MiB at  563.37KiB/s ETA 03:34 (frag 48/203)
            const progressMatch = text.match(
              /\[download\]\s+(\d+\.?\d*)%\s+of\s+~?\s*([\d.]+\w+)\s+at\s+~?\s*([\d.]+\w+\/s)\s+ETA\s+(\S+)/,
            );

            if (progressMatch) {
              const [, percentage, totalSize, speed, eta] = progressMatch;
              options?.onProgress?.(`[download] ${percentage}% of ${totalSize} at ${speed} ETA ${eta}`);
            } else {
              // Other download status: Destination, Resuming, etc. - show as log
              options?.onLog?.(text);
            }
            continue;
          }

          // Unknown lines - log as info
          options?.onLog?.(text);
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
