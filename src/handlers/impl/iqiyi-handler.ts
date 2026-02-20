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
    initialState?: {
      play?: {
        cachePlayList?: {
          [key: string]: Array<{
            albumPlayUrl?: string;
            episode?: string;
            order?: number;
            title?: string;
            subTitle?: string;
            name?: string;
            isVip?: number;
            isTvod?: number;
            payMark?: string;
            payStatus?: number;
            episodeType?: number;
            contentType?: number;
          }>;
        };
      };
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
  private readonly API_BASE = 'https://pcw-api.iq.com/api/v2';
  private readonly PAGE_SIZE = 50;

  getDomain(): string {
    return 'iq.com';
  }

  async extractEpisodes(url: string, cookies?: string): Promise<Episode[]> {
    const html = await this.fetchHtml(url, cookies);

    // Try to extract from __NEXT_DATA__ first
    const nextDataEpisodes = await this.extractFromNextData(html);
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
  private async extractFromNextData(html: string): Promise<Episode[]> {
    const episodes: Episode[] = [];

    try {
      // Extract __NEXT_DATA__ script content
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
      if (!match || !match[1]) {
        return episodes;
      }

      const nextData: NextData = JSON.parse(match[1]);

      // Try to get data from cachePlayList (newer format with albumPlayUrl)
      const cachePlayList = nextData.props?.initialState?.play?.cachePlayList;
      if (cachePlayList) {
        // Find the first key in cachePlayList (usually '1')
        const cacheKey = Object.keys(cachePlayList).find((key) => Array.isArray(cachePlayList[key]));
        if (cacheKey) {
          const videoList = cachePlayList[cacheKey];
          if (Array.isArray(videoList)) {
            for (const video of videoList) {
              const { albumPlayUrl, episode, order, subTitle, name, title } = video;

              // Skip if no albumPlayUrl
              if (!albumPlayUrl) {
                continue;
              }

              // Determine episode number: use 'order' first, then try parsing 'episode'
              let episodeNumber: number | null | undefined = order;
              if (!episodeNumber) {
                episodeNumber = this.parseEpisodeNumber(episode || subTitle || name || title || '');
              }

              if (!episodeNumber) {
                continue;
              }

              // Build URL from albumPlayUrl (it may start with //)
              const episodeUrl = albumPlayUrl.startsWith('//') ? `https:${albumPlayUrl}` : albumPlayUrl;

              // Determine episode type
              const type = this.determineTypeFromCache(video);

              // Determine title
              const episodeTitle = subTitle || name || title || (episode ? `Episode ${episode}` : undefined);
              const fullTitle = episodeTitle;

              episodes.push({
                number: episodeNumber,
                url: episodeUrl,
                type,
                title: fullTitle,
                extractedAt: new Date(),
              });
            }
          }
        }
      }

      // If we have episodes from cachePlayList, check if we need to fetch more
      if (episodes.length > 0) {
        // Try to extract albumId and total count to fetch remaining episodes
        const albumId = this.extractAlbumId(html);
        const totalCount = this.extractTotalCount(html);

        if (albumId && totalCount && totalCount > episodes.length) {
          console.log(
            `[iq.com] Found ${episodes.length} episodes in cache, fetching ${totalCount - episodes.length} more from API...`,
          );

          // Fetch remaining episodes in batches
          const remainingEpisodes = await this.fetchEpisodesFromAPI(albumId, episodes.length + 1, totalCount);
          episodes.push(...remainingEpisodes);
        }

        // Sort by episode number
        episodes.sort((a, b) => a.number - b.number);

        return episodes;
      }

      // Fallback: try old format with pageProps.data
      const dataStr = nextData.props?.pageProps?.data;
      if (dataStr) {
        const pageData: PageData = JSON.parse(dataStr as string);
        const { albumInfo, videoList = [] } = pageData;
        const { albumId, title: albumTitle } = albumInfo || {};

        for (const video of videoList) {
          const { vid, episode, order, isTrailer, subTitle, name, title } = video;

          if (isTrailer) {
            continue;
          }

          let episodeNumber: number | null | undefined = order;
          if (!episodeNumber) {
            episodeNumber = this.parseEpisodeNumber(episode || subTitle || name || title || '');
          }

          if (!episodeNumber) {
            continue;
          }

          const episodeUrl = `https://www.iq.com/play/${albumId}-${vid}?lang=en_us`;
          const type = this.determineType(video);
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
   * Determine episode type from cachePlayList video data
   */
  private determineTypeFromCache(video: {
    isVip?: number | boolean;
    payMark?: string;
    payStatus?: number;
    episodeType?: number;
  }): EpisodeType {
    const { isVip, payMark, payStatus, episodeType } = video;

    // Check explicitly for preview indicators
    if (payMark === 'preview' || episodeType === 1) {
      return EpisodeType.PREVIEW;
    }

    // Check if VIP (isVip=1 means VIP content)
    if (isVip === 1 || isVip === true || payMark === 'VIP_MARK' || payStatus === 6) {
      return EpisodeType.VIP;
    }

    return EpisodeType.AVAILABLE;
  }

  /**
   * Extract albumId from HTML
   */
  private extractAlbumId(html: string): string | null {
    // Try to find albumId in __NEXT_DATA__
    // Pattern: "albumId":8313346033482901 or "albumId":"8313346033482901"
    const match = html.match(/"albumId"\s*:\s*"?(\d+)"?/);
    return match?.[1] ?? null;
  }

  /**
   * Extract total episode count from HTML
   */
  private extractTotalCount(html: string): number | null {
    // Try to find total count in __NEXT_DATA__ - look for the one near albumLocSuffix
    // Pattern: "albumLocSuffix":"...","total":170
    const match = html.match(/"albumLocSuffix"[^}]*"total"\s*:\s*(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : null;
  }

  /**
   * Fetch episodes from API in batches
   */
  private async fetchEpisodesFromAPI(albumId: string, startOrder: number, endOrder: number): Promise<Episode[]> {
    const episodes: Episode[] = [];
    const batchSize = this.PAGE_SIZE;

    for (let start = startOrder; start <= endOrder; start += batchSize) {
      const end = Math.min(start + batchSize - 1, endOrder);

      try {
        const apiUrl = `${this.API_BASE}/episodeListSource/${albumId}?platformId=3&modeCode=intl&langCode=en_us&startOrder=${start}&endOrder=${end}&isVip=false`;
        const response = await fetch(apiUrl);
        const text = await response.text();

        // Parse response
        const data = JSON.parse(text);

        // Check for episodes in 'epg' array (newer API format)
        if (data?.data?.epg && Array.isArray(data.data.epg)) {
          for (const ep of data.data.epg) {
            const episodeNumber = ep.order;
            if (!episodeNumber) continue;

            // Build URL from playLocSuffix
            const playLocSuffix = ep.playLocSuffix;
            if (!playLocSuffix) continue;

            const fullUrl = playLocSuffix.startsWith('/')
              ? `https://www.iq.com${playLocSuffix}`
              : `https://www.iq.com/play/${playLocSuffix}`;

            // Determine VIP status
            const isVip = ep.vipInfo?.isVip === 1 || ep.vipInfo?.isVip === true;

            episodes.push({
              number: episodeNumber,
              url: fullUrl,
              type: isVip ? EpisodeType.VIP : EpisodeType.AVAILABLE,
              title: ep.name || ep.shortName || undefined,
              extractedAt: new Date(),
            });
          }
        }
        // Fallback: check for 'episodes' array (older API format)
        else if (data?.data?.episodes) {
          for (const ep of data.data.episodes) {
            const episodeNumber = ep.order || this.parseEpisodeNumber(ep.episode || ep.title || '');
            if (!episodeNumber) continue;

            const episodeUrl = ep.playUrl || ep.albumPlayUrl;
            if (!episodeUrl) continue;

            const fullUrl = episodeUrl.startsWith('//') ? `https:${episodeUrl}` : episodeUrl;

            episodes.push({
              number: episodeNumber,
              url: fullUrl,
              type: ep.isVip === 1 ? EpisodeType.VIP : EpisodeType.AVAILABLE,
              title: ep.title || ep.subtitle || undefined,
              extractedAt: new Date(),
            });
          }
        }
      } catch (error) {
        console.error(`[iq.com] Failed to fetch episodes ${start}-${end}:`, error);
      }
    }

    return episodes;
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
