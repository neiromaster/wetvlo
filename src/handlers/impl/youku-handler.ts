import { chromium } from 'playwright';
import type { Episode } from '../../types/episode.types';
import { EpisodeType } from '../../types/episode.types';
import { logger } from '../../utils/logger';
import { BaseHandler } from '../base/base-handler';

type EpisodeNode = {
  data?: {
    stage: number;
    title: string;
    paid: number;
    action?: {
      value: string;
    };
  };
};

type EpisodeComponentNode = {
  data?: {
    pageIndex?: number;
    pageSize?: number;
    lastStage?: number;
  };
  nodes?: EpisodeNode[];
  typeName?: string;
};

type InitialData = {
  data?: {
    data?: {
      nodes?: Array<{
        nodes?: EpisodeComponentNode[];
      }>;
    };
  };
};

type MtopApiResponse = {
  data?: {
    [key: string]: {
      data?: {
        nodes?: EpisodeNode[];
      };
    };
  };
};

// Resource types to block for faster loading
const BLOCKED_RESOURCE_TYPES = ['font', 'stylesheet', 'image', 'media', 'manifest', 'websocket'];

/**
 * Handler for youku.tv domain
 *
 * Uses Playwright to load the page with JavaScript execution enabled.
 * Intercepts the mtop API call that loads additional episodes.
 * Unnecessary resources (fonts, CSS, images, media) are blocked for faster loading.
 */
export class YoukuHandler extends BaseHandler {
  getDomain(): string {
    return 'youku.tv';
  }

  async extractEpisodes(url: string, cookies?: string): Promise<Episode[]> {
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new Error('Could not extract video ID from URL');
    }

    // Use Playwright to load page and extract episodes
    const episodes = await this.extractWithPlaywright(url, cookies);

    return episodes;
  }

  /**
   * Extract video ID from URL
   * Matches: https://www.youku.tv/v/v_show/id_XNjQ3MzIwNzE1Mg==.html
   */
  private extractVideoId(url: string): string | null {
    const match = url.match(/id_([^=]+)==\.html/);
    return match?.[1] ? match[1] : null;
  }

  /**
   * Load page with Playwright and extract all episodes
   *
   * Blocks unnecessary resources for faster loading:
   * - Fonts
   * - CSS stylesheets
   * - Images
   * - Media (video/audio)
   * - Manifests
   * - WebSockets
   */
  private async extractWithPlaywright(url: string, cookies?: string): Promise<Episode[]> {
    const browser = await chromium.launch({
      headless: true,
    });

    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      // Set cookies if provided
      if (cookies) {
        await context.addCookies([
          {
            name: '_m_h5_tk',
            value: cookies,
            domain: '.youku.tv',
            path: '/',
          },
        ]);
      }

      const page = await context.newPage();

      // Track API responses for additional episodes
      const apiResponses: MtopApiResponse[] = [];

      // Intercept API responses to capture episode data
      page.on('response', async (response) => {
        const requestUrl = response.url();

        // Look for mtop API responses with itemStartStage (pagination)
        if (requestUrl.includes('mtop.youku.columbus') && requestUrl.includes('itemStartStage')) {
          try {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('application/json')) {
              const body = await response.text();
              logger.debug(`Intercepted mtop API response (${body.length} chars)`);
              apiResponses.push(JSON.parse(body));
            }
          } catch (e) {
            logger.debug(`Error parsing API response: ${e}`);
          }
        }
      });

      // Block unnecessary resources for faster loading
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      // Navigate to the page and wait for episode component to load
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for initial episode data to be available
      await page.waitForFunction(
        () => {
          // @ts-expect-error - __INITIAL_DATA__ is defined on window
          const data = window.__INITIAL_DATA__;
          if (!data?.data?.data?.nodes) return false;

          const nodes = data.data.data.nodes;
          if (!nodes[0]?.nodes?.[1]?.data) return false;

          const episodeComponent = nodes[0].nodes[1];
          const episodes = episodeComponent.nodes || [];
          return episodes.length > 0;
        },
        { timeout: 15000 },
      );

      // Check initial episode count
      const initialInfo = await page.evaluate(() => {
        // @ts-expect-error - __INITIAL_DATA__ is defined on window
        const data = window.__INITIAL_DATA__;
        const nodes = data?.data?.data?.nodes;
        const episodeComponent = nodes?.[0]?.nodes?.[1];
        const episodeNodes = episodeComponent?.nodes || [];
        const { lastStage = 0 } = episodeComponent?.data || {};

        return {
          loaded: episodeNodes.length,
          total: lastStage,
        };
      });

      logger.info(`Episodes: ${initialInfo.loaded} loaded, ${initialInfo.total} total`);

      // If there are more episodes, wait for the API calls
      if (initialInfo.total > initialInfo.loaded) {
        logger.info(`Waiting for API to load remaining ${initialInfo.total - initialInfo.loaded} episodes...`);

        // Wait for all API responses or timeout
        const startTime = Date.now();
        const maxWait = 15000; // Increased timeout for multiple API calls

        // Keep waiting as long as we haven't reached all episodes and haven't timed out
        while (Date.now() - startTime < maxWait) {
          await page.waitForTimeout(500);

          // Calculate how many episodes we have so far
          const currentInfo = await page.evaluate(() => {
            // @ts-expect-error - __INITIAL_DATA__ is defined on window
            const data = window.__INITIAL_DATA__;
            const nodes = data?.data?.data?.nodes;
            const episodeComponent = nodes?.[0]?.nodes?.[1];
            const episodeNodes = episodeComponent?.nodes || [];
            const { lastStage = 0 } = episodeComponent?.data || {};
            return { loaded: episodeNodes.length, total: lastStage };
          });

          // Stop waiting if we've captured several API responses or have all episodes
          if (currentInfo.loaded >= currentInfo.total || apiResponses.length >= 3) {
            logger.success(
              `Captured ${apiResponses.length} API response(s), loaded ${currentInfo.loaded}/${currentInfo.total} episodes`,
            );
            break;
          }
        }

        if (apiResponses.length === 0) {
          logger.warning(`No API responses captured within timeout`);
        }
      }

      // Extract __INITIAL_DATA__ from the page
      const initialData = await page.evaluate(() => {
        // @ts-expect-error - __INITIAL_DATA__ is defined on window
        return window.__INITIAL_DATA__;
      });

      if (!initialData) {
        throw new Error('Could not find __INITIAL_DATA__ in page');
      }

      await context.close();

      // Parse episodes from both sources
      const episodes = this.parseInitialData(initialData);

      // If we have additional episodes from API, merge them all
      if (apiResponses.length > 0) {
        logger.info(`Processing ${apiResponses.length} API response(s)...`);

        for (const apiResponse of apiResponses) {
          const additionalEpisodes = this.parseApiResponse(apiResponse);
          logger.info(`  Merging ${additionalEpisodes.length} additional episodes`);

          // Merge episode lists, avoiding duplicates
          const existingIds = new Set(episodes.map((ep) => ep.number));
          for (const ep of additionalEpisodes) {
            if (!existingIds.has(ep.number)) {
              episodes.push(ep);
              existingIds.add(ep.number);
            }
          }
        }

        // Sort by episode number
        episodes.sort((a, b) => a.number - b.number);
      }

      logger.success(`Total episodes extracted: ${episodes.length}`);
      return episodes;
    } finally {
      await browser.close();
    }
  }

  /**
   * Parse episodes from mtop API response
   */
  private parseApiResponse(apiResponse: MtopApiResponse): Episode[] {
    const episodes: Episode[] = [];

    try {
      if (!apiResponse.data) {
        return episodes;
      }

      // Navigate to episode nodes: data["2019030100"].data.nodes
      const keys = Object.keys(apiResponse.data);
      for (const key of keys) {
        const value = apiResponse.data[key];

        if (value?.data?.nodes) {
          const episodeNodes = value.data.nodes || [];
          logger.debug(`API response: found ${episodeNodes.length} additional episodes`);

          for (const item of episodeNodes) {
            if (!item.data) continue;

            const { stage, title, paid } = item.data;
            const videoId = item.data?.action?.value;

            // Skip non-episode content
            if (!stage || stage < 1) {
              continue;
            }

            // Build URL for each episode
            const episodeUrl = `https://www.youku.tv/v/v_show/id_${videoId}.html`;

            // Determine episode type
            const type = paid === 1 ? EpisodeType.VIP : EpisodeType.AVAILABLE;

            episodes.push({
              number: stage,
              title: title || `Episode ${stage}`,
              url: episodeUrl,
              type,
              extractedAt: new Date(),
            });
          }

          break;
        }
      }
    } catch (error) {
      logger.error(`Failed to parse API response: ${error}`);
    }

    return episodes;
  }

  /**
   * Parse episodes from __INITIAL_DATA__ object
   */
  private parseInitialData(initialData: InitialData): Episode[] {
    const episodes: Episode[] = [];

    try {
      // Navigate to episode list: data.data.nodes[0].nodes[1]
      const nodes = initialData.data?.data?.nodes;
      if (!nodes || nodes.length === 0) {
        throw new Error('No nodes found in INITIAL_DATA');
      }

      // Find episode component (nodes[1] is typically "Web播放页选集组件")
      const episodeComponent = nodes[0]?.nodes?.[1];
      if (!episodeComponent) {
        throw new Error('Episode component not found');
      }

      if (!episodeComponent.data) {
        throw new Error('Episode component has no data');
      }

      const { lastStage = 0 } = episodeComponent.data;
      const episodeNodes = episodeComponent.nodes || [];

      logger.debug(`__INITIAL_DATA__: found ${episodeNodes.length} episodes (total: ${lastStage})`);

      for (const item of episodeNodes) {
        if (!item.data) continue;

        const { stage, title, paid } = item.data;
        const videoId = item.data?.action?.value;

        // Skip non-episode content
        if (!stage || stage < 1) {
          continue;
        }

        // Build URL for each episode
        const episodeUrl = `https://www.youku.tv/v/v_show/id_${videoId}.html`;

        // Determine episode type
        const type = paid === 1 ? EpisodeType.VIP : EpisodeType.AVAILABLE;

        episodes.push({
          number: stage,
          title: title || `Episode ${stage}`,
          url: episodeUrl,
          type,
          extractedAt: new Date(),
        });
      }
    } catch (error) {
      logger.error(`Failed to parse episodes from __INITIAL_DATA__: ${error}`);
      throw error;
    }

    // Sort by episode number
    episodes.sort((a, b) => a.number - b.number);

    return episodes;
  }
}
