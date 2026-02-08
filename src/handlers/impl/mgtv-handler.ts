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
      t2: string; // Title (e.g. "EP 1")
      t4: string; // Chinese title (e.g. "第1集")
      isvip: string; // "1" = VIP, "0" = Free
      url: string; // Relative URL (e.g. "/b/823701/23967831.html")
      video_id: string;
      clip_id: string;
      time: string; // Duration (e.g. "45:00")
      ts: string; // Timestamp
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

        episodes.push({
          number: episodeNumber,
          title: item.t2 || item.t4 || `Episode ${episodeNumber}`,
          url: episodeUrl,
          type: item.isvip === '1' ? EpisodeType.VIP : EpisodeType.AVAILABLE,
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
   * Deduplicate episodes based on episode number
   */
  private deduplicateEpisodes(episodes: Episode[]): Episode[] {
    const uniqueEpisodes = new Map<number, Episode>();

    for (const episode of episodes) {
      if (!uniqueEpisodes.has(episode.number)) {
        uniqueEpisodes.set(episode.number, episode);
      }
    }

    return Array.from(uniqueEpisodes.values()).sort((a, b) => a.number - b.number);
  }
}
