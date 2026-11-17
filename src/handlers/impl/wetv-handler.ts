import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Episode } from '../../types/episode.types';
import { EpisodeType } from '../../types/episode-type';
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
 * Series/episode node embedded in the Next.js App Router (flight) page
 * variant. Same data as PageData.videoList, different field names.
 */
type FlightNode = {
  currentVid?: string;
  album?: {
    id?: string;
    title?: string;
  };
  video?: {
    id?: string;
    cover_list?: string[];
  };
  episodes?: Array<{
    id?: string;
    episode?: string;
    is_trailer?: number | boolean;
    final_pay_status?: number;
    default_pay_status?: number;
    cover_list?: string[];
    labels?: PageData['videoList'][number]['labels'];
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

    // App Router flight-data variant (wetv.vip rollout, 2026-11): page ships
    // series/episode data in self.__next_f.push chunks instead of
    // __NEXT_DATA__
    const flightEpisodes = this.extractFromFlightData(html);
    if (flightEpisodes.length > 0) {
      return flightEpisodes;
    }

    // Fallback to HTML parsing (old method)
    return this.extractFromHtml(html);
  }

  /**
   * Extract episodes from __NEXT_DATA__ JSON embedded in HTML
   * This method gets ALL episodes including those not visible due to pagination
   */
  private extractFromNextData(html: string): Episode[] {
    try {
      // Extract __NEXT_DATA__ script content
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
      if (!match?.[1]) {
        return [];
      }

      const nextData: NextData = JSON.parse(match[1]);
      const dataStr = nextData.props?.pageProps?.data;
      if (!dataStr) return [];
      const pageData: PageData = JSON.parse(dataStr as string);

      return this.episodesFromVideoList(pageData.videoList ?? [], pageData.coverInfo);
    } catch (error) {
      // If extraction fails, return empty array to trigger fallback
      console.error('Failed to extract from __NEXT_DATA__:', error);
      return [];
    }
  }

  /**
   * Extract episodes from the Next.js App Router page variant: data is
   * serialized across self.__next_f.push([1, "..."]) flight chunks inside an
   * RSC node that holds "currentVid".
   */
  private extractFromFlightData(html: string): Episode[] {
    const flight = this.decodeFlightText(html);
    if (!flight) return [];

    const node = this.extractFlightNode(flight);
    if (!node) return [];

    const { album, video, episodes = [] } = node;

    // Map flight fields onto the __NEXT_DATA__ videoList shape so both
    // variants share the episode-building/classification logic
    const videoList: PageData['videoList'] = episodes.map((ep) => ({
      vid: ep.id ?? '',
      episode: ep.episode ?? '',
      isTrailer: ep.is_trailer ?? 0,
      payStatus: ep.final_pay_status,
      defaultPayStatus: ep.default_pay_status,
      coverList: ep.cover_list,
      labels: ep.labels,
    }));

    const coverInfo: PageData['coverInfo'] = {
      cid: video?.cover_list?.[0] || album?.id || '',
      title: album?.title || '',
    };

    return this.episodesFromVideoList(videoList, coverInfo);
  }

  /** Concatenate every flight chunk string into one RSC text blob. */
  private decodeFlightText(html: string): string | null {
    const chunkRe = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
    const chunks: string[] = [];
    for (const match of html.matchAll(chunkRe)) {
      try {
        chunks.push(JSON.parse(match[1]!) as string);
      } catch {
        // Skip corrupted chunk
      }
    }
    return chunks.length > 0 ? chunks.join('') : null;
  }

  /**
   * Find the smallest flight object that directly holds "currentVid":
   * walk candidate '{' positions backwards from the marker and take the
   * first whose balanced brace span contains it.
   */
  private extractFlightNode(flight: string): FlightNode | null {
    const marker = flight.indexOf('"currentVid"');
    if (marker === -1) return null;

    const opens: number[] = [];
    let idx = flight.indexOf('{');
    while (idx !== -1 && idx < marker) {
      opens.push(idx);
      idx = flight.indexOf('{', idx + 1);
    }

    for (let i = opens.length - 1; i >= 0; i--) {
      const node = this.parseObjectAt(flight, opens[i]!);
      if (node && 'currentVid' in node) {
        return node;
      }
    }
    return null;
  }

  /** JSON-decode the object starting at start (string-aware brace walk). */
  private parseObjectAt(flight: string, start: number): FlightNode | null {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < flight.length; j++) {
      const ch = flight[j]!;
      if (inStr) {
        if (esc) {
          esc = false;
        } else if (ch === '\\') {
          esc = true;
        } else if (ch === '"') {
          inStr = false;
        }
      } else if (ch === '"') {
        inStr = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(flight.slice(start, j + 1)) as FlightNode;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  /**
   * Build Episode[] from a PageData-style video list (shared by the
   * __NEXT_DATA__ and flight-data extraction paths).
   */
  private episodesFromVideoList(videoList: PageData['videoList'], coverInfo: PageData['coverInfo']): Episode[] {
    const episodes: Episode[] = [];
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
