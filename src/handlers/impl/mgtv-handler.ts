import type { Episode } from '../../types/episode.types';
import { EpisodeType } from '../../types/episode-type';
import { BaseHandler } from '../base/base-handler';

type MGTVResponse = {
  code: number;
  msg: string;
  data: {
    total_page: number;
    current_page: number;
    list: Array<{
      t1: string; // Episode number (e.g. "1")
      t2: string; // Title (e.g. "EP 1", or "Preview EP 1" for teasers)
      t3?: string; // Alternate title (matches t2)
      t4: string; // Chinese title (e.g. "第1集" — same for full episodes and teasers)
      isvip: string; // "1" = VIP, "0" = Free
      url: string; // Relative URL (e.g. "/b/823701/23967831.html")
      video_id: string;
      clip_id: string;
      time: string; // Duration (e.g. "45:00"; teasers run ~00:45)
      ts: string; // Timestamp
      isIntact?: string; // "1" = full episode, "3" = preview clip (observed 2026-11-04)
      corner?: Array<{
        // UI badges; teasers carry {area:"rightUp", flag:"2", font:"Pre"}
        area: string;
        flag: string;
        color: string;
        font: string;
      }>;
    }>;
    info: {
      title: string;
      isvip: string;
    };
  };
};

/**
 * Handler for mgtv.com domain
 */
export class MGTVHandler extends BaseHandler {
  getDomain(): string {
    return 'mgtv.com';
  }

  async extractEpisodes(url: string, cookies?: string): Promise<Episode[]> {
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new Error('Could not extract video ID from URL');
    }

    const episodes: Episode[] = [];
    let page = 0;
    let totalPages = 1;

    do {
      const apiUrl = `https://tinker.glb.mgtv.com/episode/list?src=intelmgtv&abroad=10&_support=10000000&version=5.5.35&video_id=${videoId}&page=${page}&size=50&platform=4`;

      const response = await this.fetchHtml(apiUrl, cookies);
      let data: MGTVResponse;

      try {
        data = JSON.parse(response);
      } catch (_e) {
        throw new Error('Failed to parse MGTV API response');
      }

      if (data.code !== 200) {
        throw new Error(`MGTV API error: ${data.msg}`);
      }

      totalPages = data.data.total_page;

      for (const item of data.data.list) {
        const episodeNumber = this.parseEpisodeNumber(item.t1);
        if (!episodeNumber) continue;

        const episodeUrl = `https://w.mgtv.com${item.url}`;

        // A teaser is a content kind, not a pay tier — it wins over
        // VIP/available so check.downloadTypes can gate it independently
        // (excluded by default).
        let type = item.isvip === '1' ? EpisodeType.VIP : EpisodeType.AVAILABLE;
        if (this.isTeaserEpisode(item)) {
          type = EpisodeType.TEASER;
        }

        episodes.push({
          number: episodeNumber,
          title: item.t2 || item.t4 || `Episode ${episodeNumber}`,
          url: episodeUrl,
          type,
          extractedAt: new Date(),
        });
      }

      page++;
    } while (page < totalPages);

    // Deduplicate and sort
    return this.deduplicateEpisodes(episodes);
  }

  private extractVideoId(url: string): string | null {
    // Matches /b/823701/23967831.html -> 23967831
    const match = url.match(/\/b\/\d+\/(\d+)\.html/);
    return match ? match[1] || null : null;
  }

  /**
   * Detect teaser clips ("Preview EP N"): short promos occupying an episode
   * slot before the real episode is released. Three markers, any one is
   * enough — evidence from the episode list API (2026-11-04, series 919355):
   * - t2/t3 read "Preview EP N" (t4, the Chinese title, is identical for
   *   full episodes and teasers and cannot be used);
   * - corner badge {area: "rightUp", flag: "2", font: "Pre"};
   * - isIntact "3" where full episodes carry "1".
   */
  private isTeaserEpisode(item: MGTVResponse['data']['list'][number]): boolean {
    if (/^preview/i.test(item.t2 ?? '') || /^preview/i.test(item.t3 ?? '')) {
      return true;
    }
    if (item.isIntact === '3') {
      return true;
    }
    return item.corner?.some((badge) => /^pre/i.test(badge.font ?? '')) ?? false;
  }

  /**
   * Deduplicate episodes based on episode number. The API usually lists
   * "Preview EP N" BEFORE the full "EP N", so first-wins would shadow a
   * released episode with its teaser forever — a non-teaser always
   * displaces a teaser occupying the slot.
   */
  private deduplicateEpisodes(episodes: Episode[]): Episode[] {
    const uniqueEpisodes = new Map<number, Episode>();

    for (const episode of episodes) {
      const existing = uniqueEpisodes.get(episode.number);
      if (!existing) {
        uniqueEpisodes.set(episode.number, episode);
      } else if (existing.type === EpisodeType.TEASER && episode.type !== EpisodeType.TEASER) {
        uniqueEpisodes.set(episode.number, episode);
      }
    }

    return Array.from(uniqueEpisodes.values()).sort((a, b) => a.number - b.number);
  }
}
