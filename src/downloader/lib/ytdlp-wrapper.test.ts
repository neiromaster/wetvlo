import { describe, expect, it, mock } from 'bun:test';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { YtdlpWrapper } from './ytdlp-wrapper.js';

describe('YtdlpWrapper output parsing', () => {
  it('downloads into the same directory twice without EEXIST (bun mkdir recursive quirk)', async () => {
    // Relative parent-style path that already exists: bun's
    // fsPromises.mkdir(..., {recursive: true}) throws EEXIST on it, which
    // killed every download after the first one. Cleanup must go through
    // the resolved absolute path (bun rmSync rejects relative ".." too).
    const dir = '../tmp/ytdlp-wrapper-eexist-probe';
    const dirAbs = resolve(dir);
    rmSync(dirAbs, { recursive: true, force: true });

    mock.module('execa', () => ({
      execa: mock(() => {
        const subprocess = (async () => 'done')() as unknown as Record<string, unknown>;
        subprocess.all = (async function* () {
          yield '[download] Destination: out.mp4';
        })();
        return subprocess;
      }),
    }));

    try {
      const wrapper = new YtdlpWrapper();
      await wrapper.download('https://example.com/video', 'ep', dir, {});
      await wrapper.download('https://example.com/video', 'ep', dir, {});
      expect(true).toBe(true);
    } finally {
      rmSync(dirAbs, { recursive: true, force: true });
    }
  });

  it('returns the merged output path when yt-dlp downloads separate video and audio formats', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ytdlp-wrapper-'));

    mock.module('execa', () => ({
      execa: mock(() => {
        const subprocess = (async () => 'done')() as unknown as Record<string, unknown>;
        subprocess.all = (async function* () {
          // Dual-format DASH sequence as yt-dlp prints it: the last
          // Destination is the audio stream, which [Merger] then deletes.
          yield '[download] Destination: downloads\\Ep - 01.f543.mp4';
          yield '[download] Destination: downloads\\Ep - 01.faac-aac_1.mp4';
          yield '[Merger] Merging formats into "downloads\\Ep - 01.mp4"';
          yield '[download] Deleting original file downloads\\Ep - 01.f543.mp4 (pass -k to keep)';
        })();
        return subprocess;
      }),
    }));

    const wrapper = new YtdlpWrapper();
    const result = await wrapper.download('https://example.com/video.m3u8', 'Ep - 01', dir, {});

    expect(result.filename).toBe('downloads\\Ep - 01.mp4');
    expect(result.allFiles).toContain('downloads\\Ep - 01.mp4');
  });
});

describe('YtdlpWrapper cookie file sanitization', () => {
  it('removes .www.* junk from the cookie file after yt-dlp exits (dump-back simulation)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ytdlp-wrapper-'));
    const cookieFile = join(dir, 'cookies.txt');
    writeFileSync(cookieFile, '.iq.com\tTRUE\t/\tTRUE\t2147483647\tQC005\tabc\n');

    mock.module('execa', () => ({
      execa: mock(() => {
        // Simulate yt-dlp rewriting the --cookies file from its in-memory
        // jar on exit, including injected .www.* junk cookies
        appendFileSync(
          cookieFile,
          ['.www.iq.com\tTRUE\t/\tTRUE\t0\t_gh_sess\tjunk', '.www.iq.com\tTRUE\t/\tTRUE\t0\tspanner\tjunk2', ''].join(
            '\n',
          ),
        );
        const subprocess = (async () => 'done')() as unknown as Record<string, unknown>;
        subprocess.all = (async function* () {
          yield `[download] Destination: ${join(dir, 'out.mp4')}`;
        })();
        return subprocess;
      }),
    }));

    const wrapper = new YtdlpWrapper();
    const result = await wrapper.download('https://example.com/video', 'out', dir, { cookieFile });

    expect(result.filename).toContain('out.mp4');
    const content = readFileSync(cookieFile, 'utf-8');
    expect(content).toContain('QC005\tabc');
    expect(content).not.toContain('_gh_sess');
    expect(content).not.toContain('spanner');
  });
});
