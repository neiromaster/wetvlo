import { extractVideoId, fetchAnthologyPage } from '../../downloader/lib/youku-api.js';
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
 * The anthology component's `data` block in the SSR blob — present on every
 * show, and the pagination signal: a `pageIndex`/`pageSize`/`session` triple
 * means the episode list continues beyond this page via the columbus gateway.
 */
type AnthologyContainer = {
  pageIndex?: number;
  pageSize?: number;
  session?: string;
};

/**
 * Episode-list extractor for Youku International (youku.tv).
 *
 * The episode list is embedded in the episode-page SSR HTML itself: an
 * anthology JSON component appears twice per page — but the SSR blob only
 * ever carries PAGE 1 (`pageSize` items). When the container data block shows
 * more pages, the remaining episodes are fetched from the same columbus
 * gateway the web player uses (stage-windowed requests driven by the
 * container's `session` string; anonymous calls suffice — verified live
 * 2026-11-12 on a 41-episode show whose SSR held only stages 1-35).
 *
 * Numbering uses the `stage` of 正片 items — NEVER list position (trailers can
 * sit anywhere with any stage). Mark vocabulary (live-verified 2026-11-01):
 * '' → available, VIP → vip, Express and TVOD → express; unknown non-empty
 * marks fail safe to express with a warning (a new site label must never
 * become silently downloadable). 预告片/Trailer rows are skipped entirely
 * (they are noise for downloading and would collide with real episode
 * numbers).
 */
export class YoukuHandler extends BaseHandler {
  /** Loop guard: 60 gateway pages × 35 items ≈ 2100 episodes; normal exit is `more:false`/no-growth. */
  private static readonly MAX_PAGES = 60;

  getDomain(): string {
    return 'youku.tv';
  }

  async extractEpisodes(url: string, cookies?: string): Promise<Episode[]> {
    const html = await this.fetchHtml(url, cookies);
    const items = this.extractAnthologyItems(html);

    const byVid = new Map<string, Episode>();
    const warnedMarks = new Set<string>();
    this.applyItems(items, byVid, warnedMarks, url);

    if (byVid.size === 0) {
      // Anthology blob missing/unparseable (site structure change): WARN +
      // empty list so the existing "no episodes" retry flow engages.
      console.warn(`[youku] no episodes parsed from ${url} — site structure may have changed`);
      return [];
    }

    await this.appendPaginatedPages(html, url, byVid, warnedMarks);

    return [...byVid.values()].sort((a, b) => a.number - b.number);
  }

  /**
   * Convert anthology items into episodes in `byVid` (dedupe by encodevid —
   * the SSR blob appears twice and gateway windows can overlap). Shared by the
   * SSR parse and every gateway page so marks/trailers/numbering behave
   * identically on both sources.
   */
  private applyItems(items: AnthologyItem[], byVid: Map<string, Episode>, warnedMarks: Set<string>, url: string): void {
    for (const item of items) {
      const vid = item.data?.action?.value;
      if (!vid || byVid.has(vid)) continue; // container rows + duplicated blob copies

      const videoType = item.data?.videoType ?? '';
      const mark = item.data?.mark?.data?.text ?? '';
      if (videoType === '预告片' || mark === 'Trailer') continue; // trailers skipped

      const stage = item.data?.stage;
      if (typeof stage !== 'number') continue;

      let type: EpisodeType = EpisodeType.AVAILABLE;
      if (mark === 'VIP') {
        type = EpisodeType.VIP;
      } else if (mark === 'Express' || mark === 'TVOD') {
        type = EpisodeType.EXPRESS;
      } else if (mark !== '') {
        if (!warnedMarks.has(mark)) {
          warnedMarks.add(mark);
          console.warn(`[youku] unknown availability mark "${mark}" on ${url} — treating as express`);
        }
        type = EpisodeType.EXPRESS;
      }

      byVid.set(vid, {
        number: stage,
        url: `https://www.youku.tv/v/v_show/id_${vid}.html`,
        type,
        title: item.data?.title,
        extractedAt: new Date(),
      });
    }
  }

  /**
   * Fetch anthology pages beyond SSR page 1 from the columbus gateway and
   * merge them into `byVid`. Windows advance one `pageSize` block of stages at
   * a time; the loop ends on the server's `more:false` flag or when a page
   * adds nothing new — a window past the end re-dumps the whole list, so the
   * dedupe guard is what actually terminates that case (verified live).
   * Gateway failures propagate: a silent page-1-only result would strand
   * later episodes forever.
   */
  private async appendPaginatedPages(
    html: string,
    url: string,
    byVid: Map<string, Episode>,
    warnedMarks: Set<string>,
  ): Promise<void> {
    const { pageIndex, pageSize, session } = this.extractAnthologyContainer(html) ?? {};
    if (typeof pageIndex !== 'number' || typeof pageSize !== 'number' || pageSize <= 0 || typeof session !== 'string') {
      return; // single-page show or unknown container shape — SSR list is complete
    }

    let base: Record<string, unknown>;
    try {
      base = JSON.parse(session) as Record<string, unknown>;
    } catch {
      console.warn(`[youku] unparseable anthology session on ${url} — fetching page 1 only`);
      return;
    }

    // trackInfo.pvv_vid (the episode the SSR page was rendered for) is what
    // the web player sends as videoId; the episode URL is the fallback.
    const track = base.trackInfo as { pvv_vid?: unknown } | undefined;
    const videoId = typeof track?.pvv_vid === 'string' && track.pvv_vid !== '' ? track.pvv_vid : extractVideoId(url);
    if (!videoId) {
      console.warn(`[youku] paginated anthology on ${url} but no video id found — fetching page 1 only`);
      return;
    }

    let windowStart = pageIndex * pageSize + 1; // first stage NOT in the SSR page (page 1, pageSize 35 → 36)
    for (let page = 0; page < YoukuHandler.MAX_PAGES; page++) {
      const nextSession = JSON.stringify({
        ...base,
        itemStartStage: windowStart,
        itemEndStage: windowStart + pageSize - 1,
      });
      const comp = await fetchAnthologyPage(videoId, nextSession);
      const pageItems = this.extractAnthologyItems(JSON.stringify(comp.nodes ?? []));
      const before = byVid.size;
      this.applyItems(pageItems, byVid, warnedMarks, url);
      if (byVid.size === before) break; // empty page or a re-dump of known videos (past-the-end window)
      if (comp.more === false) break; // server-declared last page (already merged above)
      windowStart += pageSize;
    }
  }

  /**
   * Find the pagination container's `data` block in the SSR HTML. Every raw
   * `"pageIndex":` anchor is expanded to its enclosing object with a
   * candidate scan: the block's key order varies (pageIndex may sit after
   * `session`), so a naive nearest-`{` scan back wanders into the
   * `\"`-escaped session string — instead each value-position `{` before the
   * anchor is tried (balanced-brace slice + JSON.parse) and the first one
   * validating as {pageIndex, pageSize, session} wins. Returns null when no
   * anchor validates (single-page shows keep their blob but pagination stays off).
   */
  private extractAnthologyContainer(html: string): AnthologyContainer | null {
    for (const match of html.matchAll(/"pageIndex":/g)) {
      const anchor = match.index ?? 0;
      for (let i = anchor; i > 0; i--) {
        const ch = html[i];
        if (ch !== '{') continue;
        const prev = html[i - 1];
        if (prev !== ':' && prev !== ',') continue;
        const end = YoukuHandler.objectEnd(html, i);
        if (end < 0) continue;
        try {
          const data = JSON.parse(html.slice(i, end + 1)) as AnthologyContainer;
          if (
            typeof data.pageIndex === 'number' &&
            typeof data.pageSize === 'number' &&
            data.pageSize > 0 &&
            typeof data.session === 'string'
          ) {
            return data;
          }
        } catch {
          // Not the container (escaped-session junk or an unrelated nested object) — keep scanning back.
        }
      }
    }
    return null;
  }

  /**
   * Pull every `type:10013` node out of a JSON text (SSR HTML or gateway page).
   * The anthology JSON also exists as a `\"`-escaped string copy which the
   * plain `"type":10013` anchor cannot match (verified: 26 plain anchors =
   * exactly 2 × (container + 10 episodes + 2 trailers)). Each anchor is
   * expanded to its enclosing object with a balanced-brace scan (string/escape
   * aware) and parsed individually; a malformed slice is ignored.
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
