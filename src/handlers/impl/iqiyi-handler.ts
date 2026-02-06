import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Episode } from '../../types/episode.types';
import { EpisodeType } from '../../types/episode.types';
import { BaseHandler } from '../base/base-handler';

type NextData = {
  props?: {
    pageProps?: {
      data?: string;
    };
  };
};

type PageData = {
  albumInfo?: {
    albumId: string;
    title: string;
  };
  videoList?: Array<{
    vid: string;
    episode?: string;
    order?: number;
    title?: string;
    subTitle?: string;
    name?: string;
    isTrailer?: number | boolean;
    payStatus?: number;
    payMark?: string;
    episodeType?: number;
    contentType?: number;
  }>;
};

/**
 * Handler for iq.com domain (iQIYI international)
 */
export class IQiyiHandler extends BaseHandler {
  getDomain(): string {
    return 'iq.com';
  }

  async extractEpisodes(url: string, cookies?: string): Promise<Episode[]> {
    const html = await this.fetchHtml(url, cookies);

    // Try to extract from __NEXT_DATA__ first (includes all episodes)
    const nextDataEpisodes = this.extractFromNextData(html);
    if (nextDataEpisodes.length > 0) {
      return nextDataEpisodes;
    }

    // Fallback to HTML parsing (old method)
    return this.extractFromHtml(html);
  }

  /**
   * Extract episodes from __NEXT_DATA__ JSON embedded in HTML
   * This method gets ALL episodes including those not visible due to pagination
   */
  private extractFromNextData(html: string): Episode[] {
    const episodes: Episode[] = [];

    try {
      // Extract __NEXT_DATA__ script content
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
      if (!match || !match[1]) {
        return episodes;
      }

      const nextData: NextData = JSON.parse(match[1]);
      const dataStr = nextData.props?.pageProps?.data;
      if (!dataStr) return episodes;

      const pageData: PageData = JSON.parse(dataStr as string);

      const { albumInfo, videoList = [] } = pageData;
      const { albumId, title: albumTitle } = albumInfo || {};

      // Process each video
      for (const video of videoList) {
        const { vid, episode, order, isTrailer, payStatus, payMark, episodeType, subTitle, name, title } = video;

        // Skip trailers
        if (isTrailer) {
          continue;
        }

        // Determine episode number: use 'order' first, then try parsing 'episode' or 'subTitle' or 'name'
        let episodeNumber: number | null | undefined = order;
        if (!episodeNumber) {
          episodeNumber = this.parseEpisodeNumber(episode || subTitle || name || title || '');
        }

        if (!episodeNumber) {
          continue;
        }

        // Build URL: /play/{albumId}-{vid}?lang=en_us
        const episodeUrl = `https://www.iq.com/play/${albumId}-${vid}?lang=en_us`;

        // Determine episode type
        const type = this.determineType(video);

        // Determine title
        const episodeTitle = subTitle || name || title || (episode ? `Episode ${episode}` : undefined);
        const fullTitle = albumTitle && episodeTitle ? `${albumTitle} - ${episodeTitle}` : episodeTitle;

        episodes.push({
          number: episodeNumber,
          url: episodeUrl,
          type,
          title: fullTitle,
          extractedAt: new Date(),
        });
      }
    } catch (error) {
      // If extraction fails, return empty array to trigger fallback
      console.error('Failed to extract from __NEXT_DATA__:', error);
    }

    // Sort by episode number
    episodes.sort((a, b) => a.number - b.number);

    return episodes;
  }

  /**
   * Determine episode type from video data
   */
  private determineType(video: NonNullable<PageData['videoList']>[number]): EpisodeType {
    const { payStatus, payMark, episodeType } = video;

    // Check explicitly for preview indicators
    if (payMark === 'preview' || episodeType === 1) {
      return EpisodeType.PREVIEW;
    }

    if (payMark === 'VIP_MARK' || payStatus === 6) {
      return EpisodeType.VIP;
    }

    return EpisodeType.AVAILABLE;
  }

  /**
   * Extract episodes from HTML (fallback method)
   */
  private extractFromHtml(html: string): Episode[] {
    const $ = this.parseHtml(html);
    const episodes: Episode[] = [];

    // Try multiple selectors for episode lists
    const selectors = [
      'ul li a[href*="/play/"]', // Most common pattern
      '.album-episode-item a[href*="/play/"]',
      '.episode-item a[href*="/play/"]',
      '.intl-play-item a[href*="/play/"]',
      '[data-episode] a[href*="/play/"]',
    ];

    for (const selector of selectors) {
      const links = $(selector);

      if (links.length > 0) {
        links.each((_, element) => {
          this.processEpisodeLink($, element, episodes);
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

  /**
   * Process a single episode link element
   */
  private processEpisodeLink($: CheerioAPI, element: AnyNode, episodes: Episode[]): void {
    const $el = $(element);
    const href = $el.attr('href');

    if (!href) return;

    // Build full URL if relative
    const episodeUrl = href.startsWith('http') ? href : `https://www.iq.com${href}`;

    // Get text content for parsing
    const text = $el.text().trim();
    const title = $el.attr('title') || undefined;

    // Filter out BTS episodes (behind-the-scenes) - check text content FIRST
    // This must happen before extracting episode number from URL
    if (text.toUpperCase().includes('BTS')) {
      return;
    }

    // Extract episode number from text FIRST (more reliable than URL)
    let episodeNumber = this.parseEpisodeNumber(text);

    // If not found in text, try href (fallback)
    if (!episodeNumber) {
      episodeNumber = this.parseEpisodeNumber(href);
    }

    if (!episodeNumber) return;

    // Check if already added
    const exists = episodes.some((ep) => ep.number === episodeNumber);
    if (exists) return;

    // Determine episode type based on VIP badges
    const type = this.determineEpisodeType($, element);

    episodes.push({
      number: episodeNumber,
      url: episodeUrl,
      type,
      title,
      extractedAt: new Date(),
    });
  }

  /**
   * Determine episode type based on badges (VIP, etc.)
   */
  private determineEpisodeType($: CheerioAPI, element: AnyNode): EpisodeType {
    // Check parent elements for VIP badge
    const $parent = $(element).closest('li, div');

    if ($parent.length) {
      const parentText = $parent.text() || '';

      // Check for VIP badge
      if (parentText.toUpperCase().includes('VIP')) {
        return EpisodeType.VIP;
      }
    }

    // Default: available (free episodes)
    return EpisodeType.AVAILABLE;
  }
}
