import { describe, expect, it, mock } from 'bun:test';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YtdlpWrapper } from './ytdlp-wrapper.js';

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
