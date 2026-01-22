import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { HandlerError } from '../../errors/custom-errors';
import type { Episode, EpisodeType } from '../../types/episode.types';
import type { DomainHandler } from '../../types/handler.types';
import { extractDomain } from '../../utils/url-utils';

/**
 * Base handler class with common functionality
 */
export abstract class BaseHandler implements DomainHandler {
  abstract getDomain(): string;

  abstract extractEpisodes(url: string, cookies?: string): Promise<Episode[]>;

  /**
   * Check if handler supports the given URL
   */
  supports(url: string): boolean {
    try {
      const domain = extractDomain(url);
      return domain === this.getDomain() || domain.endsWith(`.${this.getDomain()}`);
    } catch {
      return false;
    }
  }

  /**
   * Fetch HTML from URL with optional cookies
   */
  protected async fetchHtml(url: string, cookies?: string): Promise<string> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    if (cookies) {
      headers.Cookie = cookies;
    }

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new HandlerError(`HTTP ${response.status}: ${response.statusText}`, url);
      }

      return await response.text();
    } catch (error) {
      if (error instanceof HandlerError) {
        throw error;
      }
      throw new HandlerError(`Failed to fetch page: ${error instanceof Error ? error.message : String(error)}`, url);
    }
  }

  /**
   * Parse cheerio document from HTML
   */
  protected parseHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html);
  }

  /**
   * Parse episode number from text
   * Handles formats like "第1集", "EP1", "Episode 1", etc.
   */
  protected parseEpisodeNumber(text: string): number | null {
    // Chinese format: 第X集
    const chineseMatch = text.match(/第(\d+)集/);
    if (chineseMatch?.[1]) {
      return parseInt(chineseMatch[1], 10);
    }

    // EP prefix: EP1, ep01, etc.
    const epMatch = text.match(/ep\s?(\d+)/i);
    if (epMatch?.[1]) {
      return parseInt(epMatch[1], 10);
    }

    // Episode prefix: Episode 1, E1, etc.
    const episodeMatch = text.match(/(?:episode|e)\s?(\d+)/i);
    if (episodeMatch?.[1]) {
      return parseInt(episodeMatch[1], 10);
    }

    // Standalone number
    const numberMatch = text.match(/\b(\d+)\b/);
    if (numberMatch?.[1]) {
      return parseInt(numberMatch[1], 10);
    }

    return null;
  }

  /**
   * Parse episode type from class names or text
   */
  protected parseEpisodeType(element: AnyNode, $: cheerio.CheerioAPI): EpisodeType {
    const $el = $(element);
    const className = $el.attr('class') || '';
    const text = $el.text().toLowerCase();

    // Check for VIP indicators
    if (className.includes('vip') || text.includes('vip') || text.includes('会员')) {
      return 'vip' as EpisodeType;
    }

    // Check for preview indicators
    if (
      className.includes('preview') ||
      className.includes('trailer') ||
      text.includes('preview') ||
      text.includes('预告')
    ) {
      return 'preview' as EpisodeType;
    }

    // Check for locked indicators
    if (
      className.includes('locked') ||
      className.includes('lock') ||
      text.includes('locked') ||
      text.includes('锁定')
    ) {
      return 'locked' as EpisodeType;
    }

    return 'available' as EpisodeType;
  }
}
