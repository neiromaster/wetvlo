import type { Episode } from '../../types/episode.types';
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

    // WeTV typically has episode lists in specific selectors
    // Common patterns:
    // - .episode-item
    // - .video-episode-item
    // - [data-episode]
    // - List items with links

    // Try various selectors
    const selectors = [
      '.episode-item',
      '.video-episode-item',
      '[data-episode]',
      '.episode-list-item',
      'a[href*="/play/"]',
    ];

    for (const selector of selectors) {
      const elements = $(selector);

      if (elements.length > 0) {
        elements.each((_, element) => {
          const $el = $(element);
          const link = $el.find('a').first();
          const href = link.attr('href') || $el.attr('href') || '';

          if (!href) return;

          // Build full URL if relative
          const episodeUrl = href.startsWith('http') ? href : `https://wetv.vip${href}`;

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
                title: $el.attr('title') || $el.find('[title]').first().attr('title') || undefined,
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
