import type { Episode } from '../../types/episode.types';
import { BaseHandler } from '../base/base-handler';

/**
 * Handler for iq.com domain (iQIYI international)
 */
export class IQiyiHandler extends BaseHandler {
  getDomain(): string {
    return 'iq.com';
  }

  async extractEpisodes(url: string, cookies?: string): Promise<Episode[]> {
    const html = await this.fetchHtml(url, cookies);
    const $ = this.parseHtml(html);

    const episodes: Episode[] = [];

    // iQIYI typically has episode lists in specific selectors
    // Common patterns:
    // - .album-episode-item
    // - .episode-item
    // - .intl-play-item
    // - Links with data-episode attributes

    const selectors = [
      '.album-episode-item',
      '.episode-item',
      '.intl-play-item',
      '[data-episode]',
      'a[href*="/play/"]',
    ];

    for (const selector of selectors) {
      const elements = $(selector);

      if (elements.length > 0) {
        elements.each((_, element) => {
          const $el = $(element);
          const link = $el.is('a') ? $el : $el.find('a').first();
          const href = link.attr('href') || '';

          if (!href) return;

          // Build full URL if relative
          const episodeUrl = href.startsWith('http') ? href : `https://www.iq.com${href}`;

          // Parse episode number from text or href
          const text = $el.text();
          const hrefText = href;
          const combinedText = `${text} ${hrefText}`;

          const episodeNumber = this.parseEpisodeNumber(combinedText);

          if (episodeNumber) {
            // Check if already added
            const exists = episodes.some((ep) => ep.number === episodeNumber);
            if (!exists) {
              episodes.push({
                number: episodeNumber,
                url: episodeUrl,
                type: this.parseEpisodeType(element, $),
                title: $el.attr('title') || link.attr('title') || undefined,
                extractedAt: new Date(),
              });
            }
          }
        });

        // If we found episodes with this selector, break
        if (episodes.length > 0) {
          break;
        }
      }
    }

    // Sort by episode number
    episodes.sort((a, b) => a.number - b.number);

    return episodes;
  }
}
