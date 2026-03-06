/**
 * Event type definitions for wetvlo event-based architecture
 *
 * All events are typed for type safety and better IDE support.
 * Events follow naming pattern: <component>:<action>
 */

import type { DownloadResult } from '../downloader/download-manager';
import type { Episode } from '../types/episode.types';

// ============================================================================
// Scheduler Events
// ============================================================================

export type SchedulerStartEvent = {
  timestamp: Date;
  scheduledUrls: string[];
};

export type SchedulerTriggerEvent = {
  urls: string[];
  timestamp: Date;
};

export type SchedulerCompleteEvent = {
  timestamp: Date;
  urlsProcessed: number;
};

// ============================================================================
// Queue Events
// ============================================================================

export type QueueAddEvent = {
  queueName: string;
  taskId: string;
  type: 'check' | 'download';
  data: unknown;
  priority: boolean;
};

export type QueueTaskStartEvent = {
  queueName: string;
  taskId: string;
  type: 'check' | 'download';
  data: unknown;
  timestamp: Date;
};

export type QueueTaskCompleteEvent = {
  queueName: string;
  taskId: string;
  type: 'check' | 'download';
  result: unknown;
  timestamp: Date;
  duration: number; // milliseconds
};

export type QueueTaskErrorEvent = {
  queueName: string;
  taskId: string;
  type: 'check' | 'download';
  error: Error;
  retryCount: number;
  willRetry: boolean;
  nextRetryAt?: Date;
  timestamp: Date;
};

export type QueueDrainEvent = {
  queueName: string;
  tasksProcessed: number;
  timestamp: Date;
};

export type QueueIdleEvent = {
  timestamp: Date;
  activeQueues: string[];
};

export type QueueRegisterEvent = {
  queueName: string;
  cooldownMs: number;
};

export type QueueClearedEvent = Record<never, never>;

export type QueueResetEvent = Record<never, never>;

// ============================================================================
// Download Events
// ============================================================================

export type DownloadStartEvent = {
  url: string;
  filename: string;
  seriesUrl: string;
  episodeNumber: string;
  timestamp: Date;
};

export type DownloadProgressEvent = {
  url: string;
  filename: string;
  downloaded: number;
  total: number;
  percentage: number;
  speed: number; // bytes per second
  eta: number; // seconds
};

export type DownloadCompleteEvent = {
  url: string;
  filename: string;
  seriesUrl: string;
  episodeNumber: string;
  result: DownloadResult;
  duration: number;
  timestamp: Date;
};

export type DownloadErrorEvent = {
  url: string;
  filename: string;
  seriesUrl: string;
  episodeNumber: string;
  error: Error;
  attempt: number;
  maxAttempts: number;
  timestamp: Date;
};

export type DownloadCleanupEvent = {
  filename: string;
  pattern: string;
  filesRemoved: string[];
  timestamp: Date;
};

// ============================================================================
// Scraping Events
// ============================================================================

export type ScrapingStartEvent = {
  seriesUrl: string;
  domain: string;
  timestamp: Date;
};

export type ScrapingCompleteEvent = {
  seriesUrl: string;
  domain: string;
  episodes: Episode[];
  newEpisodes: number;
  timestamp: Date;
};

export type ScrapingErrorEvent = {
  seriesUrl: string;
  domain: string;
  error: Error;
  timestamp: Date;
};

// ============================================================================
// State Events
// ============================================================================

export type StateLoadEvent = {
  path: string;
  version: string;
  seriesCount: number;
  timestamp: Date;
};

export type StateSaveEvent = {
  path: string;
  seriesCount: number;
  episodeCount: number;
  duration: number;
  timestamp: Date;
};

export type StateUpdateEvent = {
  seriesUrl: string;
  episodeNumber: string;
  action: 'add' | 'update' | 'remove';
  timestamp: Date;
};

// ============================================================================
// Notification Events
// ============================================================================

export type NotificationEvent = {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  data?: unknown;
  timestamp: Date;
};

export type NotificationErrorEvent = {
  notifier: string;
  message: string;
  error: Error;
  timestamp: Date;
};

// ============================================================================
// System Events
// ============================================================================

export type AppStartEvent = {
  version: string;
  config: string;
  timestamp: Date;
};

export type AppShutdownEvent = {
  reason: 'sigint' | 'sigterm' | 'error' | 'complete';
  timestamp: Date;
};

export type ConfigReloadEvent = {
  path: string;
  timestamp: Date;
};

export type ConfigErrorEvent = {
  path: string;
  error: Error;
  timestamp: Date;
};

// ============================================================================
// Health/Monitoring Events
// ============================================================================

export type HealthCheckEvent = {
  timestamp: Date;
  uptime: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
};

// ============================================================================
// Unified Event Type
// ============================================================================

export type WetvloEvent = {
  // Scheduler
  'scheduler:start': SchedulerStartEvent;
  'scheduler:trigger': SchedulerTriggerEvent;
  'scheduler:complete': SchedulerCompleteEvent;

  // Queue
  'queue:register': QueueRegisterEvent;
  'queue:add': QueueAddEvent;
  'queue:task:start': QueueTaskStartEvent;
  'queue:task:complete': QueueTaskCompleteEvent;
  'queue:task:error': QueueTaskErrorEvent;
  'queue:drain': QueueDrainEvent;
  'queue:idle': QueueIdleEvent;
  'queue:cleared': QueueClearedEvent;
  'queue:reset': QueueResetEvent;

  // Download
  'download:start': DownloadStartEvent;
  'download:progress': DownloadProgressEvent;
  'download:complete': DownloadCompleteEvent;
  'download:error': DownloadErrorEvent;
  'download:cleanup': DownloadCleanupEvent;

  // Scraping
  'scraping:start': ScrapingStartEvent;
  'scraping:complete': ScrapingCompleteEvent;
  'scraping:error': ScrapingErrorEvent;

  // State
  'state:load': StateLoadEvent;
  'state:save': StateSaveEvent;
  'state:update': StateUpdateEvent;

  // Notifications
  'notification:send': NotificationEvent;
  'notification:error': NotificationErrorEvent;

  // System
  'app:start': AppStartEvent;
  'app:shutdown': AppShutdownEvent;
  'config:reload': ConfigReloadEvent;
  'config:error': ConfigErrorEvent;

  // Health
  'health:check': HealthCheckEvent;
};

// ============================================================================
// Event Name Type
// ============================================================================

export type EventName = keyof WetvloEvent;
