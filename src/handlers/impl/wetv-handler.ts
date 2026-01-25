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
  canPlay: boolean;
  coverInfo: {
    cid: string;
    title: string;
    secondTitle?: string;
  };
  videoList: Array<{
    vid: string;
    episode: string;
    isTrailer: number | boolean;
    payStatus?: number;
    defaultPayStatus?: number;
    coverList?: string[];
    labels?: {
      [key: string]: {
        text: string;
        color?: string;
      };
    };
  }>;
};

/**
 * Handler for wetv.vip domain
 */
export class WeTVHandler extends BaseHandler {
  getDomain(): string {
    return 'wetv.vip';
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

      const { coverInfo, videoList = [] } = pageData;
      const { cid, title } = coverInfo;

      // Extract CID from first video's coverList if not available in coverInfo
      const coverId = videoList[0]?.coverList?.[0] || cid;

      // Process each video
      for (const video of videoList) {
        const { vid, episode, isTrailer } = video;

        // Skip trailers/teasers
        if (isTrailer) {
          continue;
        }

        const episodeNumber = this.parseEpisodeNumber(episode);
        if (!episodeNumber) {
          continue;
        }

        // Build URL: /en/play/{cid}/{vid}-EP{episode}%3A{title}
        const encodedTitle = encodeURIComponent(title);
        const episodeUrl = `https://wetv.vip/en/play/${coverId}/${vid}-EP${episode}%3A${encodedTitle}`;

        // Determine episode type based on labels and payStatus
        const type = this.determineTypeFromVideo(video);

        episodes.push({
          number: episodeNumber,
          url: episodeUrl,
          type,
          title: `${title} - Episode ${episode}`,
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
   * Extract episodes from HTML (fallback method)
   * This only gets visible episodes (first 30 due to pagination)
   */
  private extractFromHtml(html: string): Episode[] {
    const $ = this.parseHtml(html);
    const episodes: Episode[] = [];

    // WeTV uses play-video__link class for episode links
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
   * Determine episode type from video data
   * Checks labels first, then falls back to payStatus
   */
  private determineTypeFromVideo(video: PageData['videoList'][0]): EpisodeType {
    const { labels, payStatus, defaultPayStatus } = video;

    // Check labels first (more reliable)
    if (labels) {
      for (const key in labels) {
        const label = labels[key];
        if (!label) continue;
        const labelText = label.text?.toLowerCase() || '';

        if (labelText === 'express') {
          return EpisodeType.EXPRESS;
        }
        if (labelText === 'teaser') {
          return EpisodeType.TEASER;
        }
        if (labelText === 'vip') {
          return EpisodeType.VIP;
        }
      }
    }

    // Fallback to payStatus
    const status = payStatus || defaultPayStatus;
    if (status === 6) {
      return EpisodeType.VIP;
    }
    if (status === 12) {
      return EpisodeType.EXPRESS;
    }
    return EpisodeType.AVAILABLE;
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
