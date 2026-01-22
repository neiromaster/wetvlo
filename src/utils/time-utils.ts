/**
 * Parse time string in HH:MM format
 *
 * @param timeStr - Time string in HH:MM format (e.g., "20:00")
 * @returns Date object with today's date and the specified time
 */
export function parseTime(timeStr: string): Date {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid time format: "${timeStr}". Expected HH:MM`);
  }

  const [, hoursStr, minutesStr] = match;
  const hours = parseInt(hoursStr || '0', 10);
  const minutes = parseInt(minutesStr || '0', 10);

  if (hours < 0 || hours > 23) {
    throw new Error(`Invalid hours: ${hours}. Must be between 0 and 23`);
  }

  if (minutes < 0 || minutes > 59) {
    throw new Error(`Invalid minutes: ${minutes}. Must be between 0 and 59`);
  }

  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/**
 * Get milliseconds until the next occurrence of a time
 *
 * @param timeStr - Time string in HH:MM format
 * @returns Milliseconds until the next occurrence
 */
export function getMsUntilTime(timeStr: string): number {
  const targetTime = parseTime(timeStr);
  const now = new Date();

  const targetDate = new Date(now);
  targetDate.setHours(targetTime.getHours(), targetTime.getMinutes(), 0, 0);

  // If the time has already passed today, schedule for tomorrow
  if (targetDate <= now) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  return targetDate.getTime() - now.getTime();
}

/**
 * Format duration in human-readable format
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Sleep for specified milliseconds
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
