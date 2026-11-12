import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EpisodeType } from '../../types/episode-type';
import { YoukuHandler } from './youku-handler';

describe('YoukuHandler', () => {
  let handler: YoukuHandler;
  let fixtureHtml: string;
  const EP_URL = 'https://www.youku.tv/v/v_show/id_XNjU3NzMxMTcxNg==.html';

  beforeEach(async () => {
    handler = new YoukuHandler();
    fixtureHtml = await readFile(join(import.meta.dir, 'fixtures', 'youku-ep-page.html'), 'utf-8');
  });

  /**
   * Route global.fetch by URL: the series page serves `html`; columbus
   * gateway calls get `gatewayReplies` in order (defaulting to an empty final
   * page that stops the loop after one call) and record their URLs in
   * `gatewayCalls`.
   */
  function stubPage(html: string, capture?: { cookie?: string }, gatewayReplies?: object[], gatewayCalls?: string[]) {
    global.fetch = mock(async (_input: any, init?: any) => {
      const url = String(_input);
      if (url.includes('acs.youku.tv')) {
        gatewayCalls?.push(url);
        const reply = gatewayReplies?.shift() ?? {
          ret: ['SUCCESS::调用成功'],
          data: { 2019030100: { data: { more: false, nodes: [] } } },
        };
        return new Response(JSON.stringify(reply), { status: 200 });
      }
      if (capture) capture.cookie = (init?.headers as Record<string, string>)?.Cookie;
      return new Response(html, { status: 200 });
    }) as any;
  }

  describe('getDomain / supports', () => {
    it('returns youku.tv', () => {
      expect(handler.getDomain()).toBe('youku.tv');
    });

    it('supports youku.tv and subdomains, rejects others', () => {
      expect(handler.supports('https://www.youku.tv/v/v_show/id_XNjU3NzMxMTcxNg==.html')).toBe(true);
      expect(handler.supports('https://youku.tv/v/v_show/id_XNjU3NzMxMTcxNg==.html')).toBe(true);
      expect(handler.supports('https://wetv.vip/play/abc')).toBe(false);
    });
  });

  describe('extractEpisodes', () => {
    it('parses the live SSR page into 10 numbered episodes with correct types', async () => {
      stubPage(fixtureHtml);

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes).toHaveLength(10);
      expect(episodes.map((e) => e?.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      // marks in the fixture: EP1-3 free, EP4-8 VIP, EP9-10 Express
      expect(episodes[0]?.type).toBe(EpisodeType.AVAILABLE);
      expect(episodes[2]?.type).toBe(EpisodeType.AVAILABLE);
      expect(episodes[3]?.type).toBe(EpisodeType.VIP);
      expect(episodes[7]?.type).toBe(EpisodeType.VIP);
      expect(episodes[8]?.type).toBe(EpisodeType.EXPRESS);
      expect(episodes[9]?.type).toBe(EpisodeType.EXPRESS);

      // numbering comes from `stage`, not list position (Trailers sit at 11/12 with stage 9/10)
      expect(episodes[7]?.url).toBe(EP_URL);
      expect(episodes[7]?.title).toBe('Good Night 08');
      expect(episodes[0]?.title).toBe('Good Night 01');

      // trailers are skipped entirely
      expect(episodes.some((e) => (e?.title ?? '').includes('Trailer'))).toBe(false);
    });

    it('dedupes when the anthology blob appears twice', async () => {
      stubPage(fixtureHtml + fixtureHtml);

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes).toHaveLength(10);
    });

    it('tolerates a malformed anchor slice and keeps the intact episodes', async () => {
      // Corrupt item: braces still balance (so the balanced-brace scan finds an
      // end and JSON.parse runs) but the payload is invalid JSON — the per-item
      // try/catch must drop it silently while the intact sibling survives.
      const intact =
        '{"type":10013,"data":{"videoType":"正片","title":"Good Night 01","stage":1,"action":{"value":"VID1"}}}';
      const corrupt =
        '{"type":10013,"data":{"videoType" "正片","title":"Good Night 02","stage":2,"action":{"value":"VID2"}}}';
      stubPage(`<html><body><script>{"items":[${intact},${corrupt}]}</script></body></html>`);

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes).toHaveLength(1);
      expect(episodes[0]?.number).toBe(1);
      expect(episodes[0]?.title).toBe('Good Night 01');
    });

    it('types TVOD-marked episodes as express', async () => {
      // Live mark vocabulary (Notes of DNA Appraiser, 2026-11-01): TVOD is the
      // pay-per-view label — a paid category like Express, not free content.
      const item =
        '{"type":10013,"data":{"videoType":"正片","title":"Notes of DNA Appraiser 07","stage":7,"action":{"value":"VID7"},"mark":{"data":{"text":"TVOD"}}}}';
      stubPage(`<html><body><script>{"items":[${item}]}</script></body></html>`);

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes).toHaveLength(1);
      expect(episodes[0]?.number).toBe(7);
      expect(episodes[0]?.type).toBe(EpisodeType.EXPRESS);
    });

    it('fails safe on an unknown mark: express with a warning', async () => {
      const item =
        '{"type":10013,"data":{"videoType":"正片","title":"Good Night 02","stage":2,"action":{"value":"VID2"},"mark":{"data":{"text":"FuturePaywall"}}}}';
      stubPage(`<html><body><script>{"items":[${item}]}</script></body></html>`);
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (message?: unknown) => {
        warnings.push(String(message));
      };

      try {
        const episodes = await handler.extractEpisodes(EP_URL);

        expect(episodes).toHaveLength(1);
        expect(episodes[0]?.type).toBe(EpisodeType.EXPRESS);
        expect(warnings.some((w) => w.includes('FuturePaywall'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('returns [] when the anthology blob is missing (structural change)', async () => {
      stubPage('<html><body>unexpected structure</body></html>');

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes).toEqual([]);
    });

    it('passes cookies to the page fetch', async () => {
      const capture: { cookie?: string } = {};
      stubPage(fixtureHtml, capture);

      await handler.extractEpisodes(EP_URL, 'cna=x; P_sck=y');

      expect(capture.cookie).toBe('cna=x; P_sck=y');
    });
  });

  describe('pagination', () => {
    /** Gateway envelope for one anthology page (`data["2019030100"].data` is the component). */
    function gatewayPage(nodes: unknown[], more: boolean, ret = 'SUCCESS::调用成功') {
      return { ret: [ret], data: { 2019030100: { data: { more, nodes } } } };
    }

    function gwItem(vid: string, stage: number, mark = 'VIP'): unknown {
      return {
        type: 10013,
        data: {
          videoType: '正片',
          title: `Show ${stage}`,
          stage,
          action: { value: vid },
          mark: { data: { text: mark } },
        },
      };
    }

    /**
     * SSR page with a paginated anthology container, mirroring the live blob:
     * session JSON (escaped string) + pageSize + pageIndex inside the
     * component's data block, and page-1 episode items in `nodes`. The
     * session/pageSize/pageIndex key order matches the live fixture (session
     * FIRST, pageIndex later) so the candidate-scan locator is exercised.
     * `sessionJson` is the raw session string — pass JSON.stringify of the
     * desired session object, or something non-JSON to test that path.
     */
    function containerHtml(sessionJson: string, opts: { pageIndex?: number; pageSize?: number } = {}): string {
      const session = sessionJson.replace(/"/g, '\\"');
      const pageSize = opts.pageSize ?? 2;
      const pageIndex = opts.pageIndex ?? 1;
      const items =
        `{"type":10013,"data":{"videoType":"正片","title":"Show 01","stage":1,"action":{"value":"VID1"},"mark":{"data":{"text":""}}}},` +
        `{"type":10013,"data":{"videoType":"正片","title":"Show 02","stage":2,"action":{"value":"VID2"},"mark":{"data":{"text":"VIP"}}}}`;
      return (
        `<html><body><script>{"root":{"id":242627,"level":2,"type":10013,"data":{"session":"${session}",` +
        `"pageSize":${pageSize},"title":"Episodes","pageIndex":${pageIndex}},"nodes":[${items}]}}</script></body></html>`
      );
    }

    it('fetches gateway pages beyond SSR page 1 and merges them, sorted', async () => {
      // Live-verified 2026-11-12: a 41-episode show whose SSR blob holds only
      // stages 1-35 (pageIndex:1, pageSize:35); episodes 36+ came only from
      // this gateway. Synthetic two-page shape here, same component keys.
      const calls: string[] = [];
      stubPage(
        containerHtml(
          JSON.stringify({
            trackInfo: { pvv_vid: 'PAGE1VID', pvv_sid: 'show123' },
            id: 242627,
            index: 2,
            lastSubIndex: 2,
          }),
          {
            pageSize: 2,
          },
        ),
        undefined,
        [gatewayPage([gwItem('VID3', 3), gwItem('VID4', 4)], false)],
        calls,
      );

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes.map((e) => e.number)).toEqual([1, 2, 3, 4]);
      expect(episodes[2]?.type).toBe(EpisodeType.VIP);
      expect(episodes[2]?.url).toBe('https://www.youku.tv/v/v_show/id_VID3.html');
      expect(calls).toHaveLength(1);

      // request shape: ms_codes + stage window (next page) + videoId from session trackInfo
      const data = JSON.parse(new URL(calls[0]!).searchParams.get('data') ?? '{}') as {
        ms_codes: string;
        params: string;
      };
      expect(data.ms_codes).toBe('2019030100');
      const params = JSON.parse(data.params) as { videoId: string; nextSession: string };
      expect(params.videoId).toBe('PAGE1VID');
      const nextSession = JSON.parse(params.nextSession) as {
        itemStartStage: number;
        itemEndStage: number;
        id: number;
      };
      expect(nextSession.itemStartStage).toBe(3); // pageIndex*pageSize+1 — first stage past the SSR page
      expect(nextSession.itemEndStage).toBe(4);
      expect(nextSession.id).toBe(242627);
    });

    it('walks multiple pages until the server-declared last page (more:false)', async () => {
      const calls: string[] = [];
      stubPage(
        containerHtml(JSON.stringify({ trackInfo: { pvv_vid: 'PAGE1VID' } }), { pageSize: 2 }),
        undefined,
        [gatewayPage([gwItem('VID3', 3)], true), gatewayPage([gwItem('VID4', 4)], false)],
        calls,
      );

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes.map((e) => e.number)).toEqual([1, 2, 3, 4]);
      expect(calls).toHaveLength(2);
    });

    it('stops when a gateway page adds nothing new (past-the-end windows re-dump the list)', async () => {
      // Live behavior 2026-11-12: a window beyond the final stage answers with
      // the WHOLE list again — dedupe by vid must terminate the loop.
      const calls: string[] = [];
      stubPage(
        containerHtml(JSON.stringify({ trackInfo: { pvv_vid: 'PAGE1VID' } }), { pageSize: 2 }),
        undefined,
        [gatewayPage([gwItem('VID1', 1), gwItem('VID2', 2)], true)],
        calls,
      );

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(episodes.map((e) => e.number)).toEqual([1, 2]);
      expect(calls).toHaveLength(1);
    });

    it('falls back to the episode URL video id when the session has no trackInfo', async () => {
      const calls: string[] = [];
      stubPage(
        containerHtml(JSON.stringify({ id: 242627, index: 2 }), { pageSize: 2 }),
        undefined,
        [gatewayPage([], false)],
        calls,
      );

      await handler.extractEpisodes(EP_URL);

      expect(calls).toHaveLength(1);
      const data = JSON.parse(new URL(calls[0]!).searchParams.get('data') ?? '{}') as { params: string };
      expect((JSON.parse(data.params) as { videoId: string }).videoId).toBe('XNjU3NzMxMTcxNg==');
    });

    it('skips the gateway entirely when no video id is resolvable', async () => {
      const calls: string[] = [];
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (message?: unknown) => warnings.push(String(message));
      try {
        stubPage(containerHtml(JSON.stringify({ id: 242627 }), { pageSize: 2 }), undefined, [], calls);

        const episodes = await handler.extractEpisodes('https://www.youku.tv/nowplaying');

        expect(calls).toHaveLength(0); // only the page fetch happened
        expect(episodes.map((e) => e.number)).toEqual([1, 2]);
        expect(warnings.some((w) => w.includes('no video id'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('propagates gateway failures so the retry flow engages', async () => {
      stubPage(containerHtml(JSON.stringify({ trackInfo: { pvv_vid: 'PAGE1VID' } }), { pageSize: 2 }), undefined, [
        gatewayPage([], false, 'FAIL_SYS_FLOW'),
      ]);

      await expect(handler.extractEpisodes(EP_URL)).rejects.toThrow(/FAIL_SYS_FLOW/);
    });

    it('tolerates an unparseable session string and keeps the SSR page', async () => {
      const calls: string[] = [];
      stubPage(containerHtml('{broken json', { pageSize: 2 }), undefined, [], calls);

      const episodes = await handler.extractEpisodes(EP_URL);

      expect(calls).toHaveLength(0);
      expect(episodes.map((e) => e.number)).toEqual([1, 2]);
    });
  });
});
