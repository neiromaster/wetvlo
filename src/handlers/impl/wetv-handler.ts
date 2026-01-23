import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Episode } from '../../types/episode.types';
import { EpisodeType } from '../../types/episode.types';
import { BaseHandler } from '../base/base-handler';

/**
 * Handler for wetv.vip domain
 */
export class WeTVHandler extends BaseHandler {
  getDomain(): string {
    return 'wetv.vip';
  }

  async extractEpisodes(url: string, cookies?: string): Promise<Episode[]> {
    const html = await this.fetchHtml(url, cookies);
    const $ = this.parseHtml(html);

    const episodes: Episode[] = [];

    // WeTV uses play-video__link class for episode links
    // Pattern: a.play-video__link[href*="/play/"][href*="EP"]
    const episodeLinks = $('a.play-video__link[href*="/play/"][href*="EP"]');

    if (episodeLinks.length === 0) {
      // Fallback: try generic selector
      const fallbackLinks = $('a[href*="/play/"]').filter((_, el) => {
        const href = $(el).attr('href') || '';
        return href.includes('EP');
      });

      fallbackLinks.each((_, element) => {
        this.processEpisodeLink($, element, episodes);
      });
    } else {
      episodeLinks.each((_, element) => {
        this.processEpisodeLink($, element, episodes);
      });
    }

    // Sort by episode number
    episodes.sort((a, b) => a.number - b.number);

    return episodes;
  }

  /**
   * Process a single episode link element
   */
  private processEpisodeLink($: CheerioAPI, element: AnyNode, episodes: Episode[]): void {
    const $el = $(element);
    const href = $el.attr('href');

    if (!href) return;

    // Build full URL if relative
    const episodeUrl = href.startsWith('http') ? href : `https://wetv.vip${href}`;

    // Extract episode number from aria-label (e.g., "Play episode 01")
    const ariaLabel = $el.attr('aria-label') || '';
    const episodeNumber = this.parseEpisodeNumber(ariaLabel);

    if (!episodeNumber) return;

    // Check if already added
    const exists = episodes.some((ep) => ep.number === episodeNumber);
    if (exists) return;

    // Determine episode type based on badges
    const type = this.determineEpisodeType($, element);

    episodes.push({
      number: episodeNumber,
      url: episodeUrl,
      type,
      title: $el.attr('title') || undefined,
      extractedAt: new Date(),
    });
  }

  /**
   * Determine episode type based on badges (VIP, Teaser, Express)
   */
  private determineEpisodeType($: CheerioAPI, element: AnyNode): EpisodeType {
    // Check for badges in parent li or sibling elements
    const $li = $(element).closest('li');

    if ($li.length) {
      // Look for span.play-video__label
      const badge = $li.find('span.play-video__label').first();

      if (badge.length) {
        const badgeText = badge.text().trim().toLowerCase();

        // Check badge types
        if (badgeText === 'vip' || badgeText.includes('vip')) {
          return EpisodeType.VIP;
        }
        if (badgeText === 'teaser' || badgeText.includes('teaser')) {
          return EpisodeType.TEASER;
        }
        if (badgeText === 'express' || badgeText.includes('express')) {
          return EpisodeType.EXPRESS;
        }
      }

      // Also check text content for badges
      const liText = $li.text() || '';
      if (liText.includes('VIP') && !liText.includes('Teaser')) {
        return EpisodeType.VIP;
      }
      if (liText.includes('Teaser')) {
        return EpisodeType.TEASER;
      }
      if (liText.includes('Express')) {
        return EpisodeType.EXPRESS;
      }
    }

    // Default: available (free episodes)
    return EpisodeType.AVAILABLE;
  }
}
