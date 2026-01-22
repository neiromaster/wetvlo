import type { Episode } from './episode.types';

/**
 * Domain handler interface for extracting episode data
 */
export type DomainHandler = {
  /**
   * Get the domain this handler supports
   */
  getDomain(): string;

  /**
   * Extract episode list from series page
   * @param url - URL of the series page
   * @param cookies - Cookie string for authentication
   * @returns Array of episodes
   */
  extractEpisodes(url: string, cookies?: string): Promise<Episode[]>;

  /**
   * Check if the handler supports the given URL
   * @param url - URL to check
   */
  supports(url: string): boolean;
};

/**
 * Handler registry interface
 */
export type HandlerRegistry = {
  /**
   * Register a handler
   */
  register(handler: DomainHandler): void;

  /**
   * Get handler for URL
   */
  getHandler(url: string): DomainHandler | undefined;

  /**
   * Get all registered domains
   */
  getDomains(): string[];
};
