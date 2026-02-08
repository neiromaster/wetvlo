import { createEnum } from '../utils/create-enum';

const notificationLevel = createEnum(['debug', 'info', 'success', 'highlight', 'warning', 'error'] as const);

export const NotificationLevel = notificationLevel.object;

export type NotificationLevel = typeof notificationLevel.type;

export const NotificationLevelSchema = notificationLevel.schema;

/**
 * Level priorities for filtering (lower = less severe)
 */
export const LEVEL_PRIORITIES = {
  debug: 0,
  info: 1,
  success: 2,
  highlight: 3,
  warning: 4,
  error: 5,
} as const satisfies Record<NotificationLevel, number>;
