import { beforeEach, describe, expect, it } from 'bun:test';
import type { Episode } from '../types/episode.types.js';
import type { DomainHandler } from '../types/handler.types.js';
import { Registry } from './handler-registry.js';

// Mock Handler
class MockHandler implements DomainHandler {
  private domain: string;

  constructor(domain: string) {
    this.domain = domain;
  }

  getDomain(): string {
    return this.domain;
  }

  async extractEpisodes(_url: string, _cookies?: string): Promise<Episode[]> {
    return [];
  }

  supports(url: string): boolean {
    return url.includes(this.domain);
  }
}

describe('HandlerRegistry', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
  });

  it('should register and retrieve handler', () => {
    const handler = new MockHandler('example.com');
    registry.register(handler);

    const retrieved = registry.getHandler('https://example.com/video');
    expect(retrieved).toBe(handler);
  });

  it('should retrieve handler for subdomain', () => {
    const handler = new MockHandler('example.com');
    registry.register(handler);

    const retrieved = registry.getHandler('https://www.example.com/video');
    expect(retrieved).toBe(handler);
  });

  it('should return undefined for unknown domain', () => {
    const handler = new MockHandler('example.com');
    registry.register(handler);

    const retrieved = registry.getHandler('https://other.com');
    expect(retrieved).toBeUndefined();
  });

  it('should throw error for unknown domain when using getHandlerOrThrow', () => {
    registry.register(new MockHandler('example.com'));

    expect(() => registry.getHandlerOrThrow('https://unknown.com')).toThrow('No handler found');
  });

  it('should list all registered domains', () => {
    registry.register(new MockHandler('domain1.com'));
    registry.register(new MockHandler('domain2.com'));

    const domains = registry.getDomains();
    expect(domains).toContain('domain1.com');
    expect(domains).toContain('domain2.com');
    expect(domains).toHaveLength(2);
  });
});
