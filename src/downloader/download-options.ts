import type { ResolvedConfig } from '../config/config-schema.js';

export type DownloadOptions = {
  downloadDir: string;
  tempDir?: string;
  cookieFile?: string;
  minDuration: number;
  subLangs?: string[];
  subsBeforeVideo: boolean;
};

export function extractDownloadOptions(resolvedConfig: ResolvedConfig<'series'>): DownloadOptions {
  return {
    downloadDir: resolvedConfig.download.downloadDir,
    tempDir: resolvedConfig.download.tempDir,
    cookieFile: resolvedConfig.cookieFile,
    minDuration: resolvedConfig.download.minDuration,
    subLangs: resolvedConfig.subLangs,
    subsBeforeVideo: resolvedConfig.download.subsBeforeVideo,
  };
}
