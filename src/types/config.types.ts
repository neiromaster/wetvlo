/**
 * Scheduler mode
 */
export type SchedulerMode = 'scheduled' | 'once';

/**
 * Scheduler options
 */
export type SchedulerOptions = {
  mode: SchedulerMode;
  onIdle?: () => void;
};
