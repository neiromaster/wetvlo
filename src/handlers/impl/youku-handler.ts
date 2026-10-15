import type { Episode } from '../../types/episode.types';
import { EpisodeType } from '../../types/episode-type';
import { BaseHandler } from '../base/base-handler';

/**
 * One `type:10013` node of the `international_pc_detail_anthology2` SSR
 * component. Only `data` matters: videoType, title, stage, action.value
 * (encodevid) and mark.data.text (availability label).
 */
type AnthologyItem = {
  data?: {
    videoType?: string;
    title?: string;
    stage?: number;
    action?: { value?: string | null };
    mark?: { data?: { text?: string } };
  };
};

/**
 * Episode-list extractor for Youku International (youku.tv).
 *
 * The episode list is embedded in the episode-page SSR HTML itself (no list
 * API): an anthology JSON component appears twice per page. Numbering uses the
 * `stage` of 正片 items — NEVER list position (trailers can sit anywhere with
 * any stage). Mark vocabulary: '' → available, VIP → vip, Express → express;
 * 预告片/Trailer rows are skipped entirely (they are noise for downloading and
 * would collide with real episode numbers).
 */
export class YoukuHandler extends BaseHandler {
  getDomain(): string {
    return 'youku.tv';
  }

  async extractEpisodes(url: string, cookies?: string): Promise<Episode[]> {
    const html = await this.fetchHtml(url, cookies);
    const items = this.extractAnthologyItems(html);

    const byVid = new Map<string, Episode>();
    for (const item of items) {
      const vid = item.data?.action?.value;
      if (!vid || byVid.has(vid)) continue; // container rows + the duplicated blob copy

      const videoType = item.data?.videoType ?? '';
      const mark = item.data?.mark?.data?.text ?? '';
      if (videoType === '预告片' || mark === 'Trailer') continue; // trailers skipped

      const stage = item.data?.stage;
      if (typeof stage !== 'number') continue;

      byVid.set(vid, {
        number: stage,
        url: `https://www.youku.tv/v/v_show/id_${vid}.html`,
        type: mark === 'VIP' ? EpisodeType.VIP : mark === 'Express' ? EpisodeType.EXPRESS : EpisodeType.AVAILABLE,
        title: item.data?.title,
        extractedAt: new Date(),
      });
    }

    if (byVid.size === 0) {
      // Anthology blob missing/unparseable (site structure change): WARN +
      // empty list so the existing "no episodes" retry flow engages.
      console.warn(`[youku] no episodes parsed from ${url} — site structure may have changed`);
      return [];
    }

    return [...byVid.values()].sort((a, b) => a.number - b.number);
  }

  /**
   * Pull every `type:10013` node out of the SSR HTML. The anthology JSON also
   * exists as a `\"`-escaped string copy which the plain `"type":10013` anchor
   * cannot match (verified: 26 plain anchors = exactly 2 × (container + 11
   * episodes + 2 trailers)). Each anchor is expanded to its enclosing object
   * with a balanced-brace scan (string/escape aware) and parsed individually;
   * a malformed slice is ignored — zero items overall triggers the WARN path.
   */
  private extractAnthologyItems(html: string): AnthologyItem[] {
    const items: AnthologyItem[] = [];
    for (const match of html.matchAll(/"type":10013/g)) {
      const start = YoukuHandler.itemStart(html, match.index ?? 0);
      if (start < 0) continue;
      const end = YoukuHandler.objectEnd(html, start);
      if (end < 0) continue;
      try {
        items.push(JSON.parse(html.slice(start, end + 1)) as AnthologyItem);
      } catch {
        // Malformed slice — skip; the zero-items WARN covers total breakage.
      }
    }
    return items;
  }

  /** Index of the `{` opening the object containing `pos` (preceded by `[` or `,`), or -1. */
  private static itemStart(html: string, pos: number): number {
    let i = pos;
    while (i > 0) {
      if (html[i] === '{') {
        const prev = html[i - 1];
        if (prev === '[' || prev === ',') return i;
      }
      i--;
    }
    return -1;
  }

  /** Index of the `}` closing the object opened at `start`, honoring strings; -1 if unbalanced. */
  private static objectEnd(html: string, start: number): number {
    let depth = 0;
    let inString = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }
}
