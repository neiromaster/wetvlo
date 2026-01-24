import { execa } from 'execa';
import { logger } from './logger';

/**
 * Utility to validate video files
 */

/**
 * Get video duration in seconds using ffprobe
 *
 * @param filePath - Path to video file
 * @returns Duration in seconds, or 0 if failed
 */
export async function getVideoDuration(filePath: string): Promise<number> {
  try {
    // ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 input.mp4
    const { stdout } = await execa('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);

    const duration = parseFloat(stdout.trim());
    return Number.isNaN(duration) ? 0 : duration;
  } catch (error) {
    logger.error(
      `Failed to get video duration for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}

/**
 * Check if ffprobe is installed
 */
export async function checkFfprobeInstalled(): Promise<boolean> {
  try {
    await execa('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}
