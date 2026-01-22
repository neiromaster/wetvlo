import { HandlerError } from '../errors/custom-errors';
import type { DomainHandler, HandlerRegistry } from '../types/handler.types';
import { extractDomain } from '../utils/url-utils';

/**
 * Handler registry implementation
 */
export class Registry implements HandlerRegistry {
  private handlers: Map<string, DomainHandler> = new Map();

  /**
   * Register a handler
   */
  register(handler: DomainHandler): void {
    this.handlers.set(handler.getDomain(), handler);
  }

  /**
   * Get handler for URL
   */
  getHandler(url: string): DomainHandler | undefined {
    const domain = extractDomain(url);

    // First try exact match
    if (this.handlers.has(domain)) {
      return this.handlers.get(domain);
    }

    // Then try subdomain match (e.g., www.wetv.vip -> wetv.vip)
    for (const [handlerDomain, handler] of this.handlers.entries()) {
      if (domain === handlerDomain || domain.endsWith(`.${handlerDomain}`) || handlerDomain.endsWith(`.${domain}`)) {
        return handler;
      }
    }

    return undefined;
  }

  /**
   * Get all registered domains
   */
  getDomains(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get handler or throw error
   */
  getHandlerOrThrow(url: string): DomainHandler {
    const handler = this.getHandler(url);
    if (!handler) {
      throw new HandlerError(
        `No handler found for domain: "${extractDomain(url)}". ` + `Supported domains: ${this.getDomains().join(', ')}`,
        url,
      );
    }
    return handler;
  }
}

// Global registry instance
export const handlerRegistry: Registry = new Registry();
