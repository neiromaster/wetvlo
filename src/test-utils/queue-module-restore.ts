import { afterAll, mock } from 'bun:test';

/**
 * Queue an afterAll hook that re-registers the REAL module for `specifier`,
 * undoing this file's `mock.module` registration. Call it immediately after
 * each literal `mock.module()` registration in a test file, passing the test
 * file's own directory:
 *
 * ```ts
 * mock.module('../utils/firefox-cookies', () => ({
 *   readCookieHeaderForUrl: mockReadCookieHeaderForUrl,
 * }));
 * queueModuleRestore('../utils/firefox-cookies', import.meta.dir);
 * ```
 *
 * Why this exists — bun's mock.module leak (observed on bun 1.4.4, Windows):
 *
 * 1. bun hoists `mock.module(...)` above imports and the registration OUTLIVES
 *    the test file: any later test file running in the same worker that imports
 *    the mocked specifier resolves the MOCK, not the real module. bun has no
 *    official unmock API.
 * 2. Failing mode: with the default `bun test` this is masked by worker
 *    scheduling, but `bun test --no-isolate --parallel=2` (or `=4`) fails
 *    deterministically — e.g. `src/utils/firefox-cookies.test.ts` received
 *    mocked cookie values, and `src/handlers/handler-registry.test.ts` saw a
 *    mock's exports instead of the real `Registry` class.
 * 3. The restore re-registers the real module so later files are unaffected.
 *    Two non-obvious details make this work:
 *    - The module id passed to the restoring `mock.module()` call must be the
 *      CANONICAL resolved path (`Bun.resolveSync(specifier, importerDir)`,
 *      which applies the same js→ts mapping as imports). A raw relative id
 *      would be resolved against the calling module — this helper, not the
 *      test file — or canonicalize differently (.js kept as .js), and the
 *      re-registration would silently land on a different registry key than
 *      the original mock, leaving the mock in place (all verified
 *      empirically; re-registration on the same canonical key is
 *      last-write-wins).
 *    - The real module is fetched by importing the canonical path with a
 *      `?restore` query suffix: bun treats the query as a different module key
 *      that BYPASSES the mock registry, so the dynamic import returns the
 *      unmocked module. A plain import (or a namespace captured at import
 *      time) hands back the mock itself, because bun hoists `mock.module`
 *      above imports.
 * 4. The registration itself MUST stay a literal `mock.module()` call in the
 *    test file: calls inside a helper are not hoisted above imports, so the
 *    mock applies only from the call site onward; keep registrations literal
 *    in the test file so they reliably precede every import.
 *
 * Scope: only modules with cross-file consumers in the suite need this
 * restore. Files mocking modules that nothing else imports as a test subject
 * (execa in downloader/ytdlp/video-validator tests, cmd-ts in index.test.ts,
 * the logger in console-notifier.test.ts) register without a restore and are
 * fine as-is.
 *
 * If the specifier cannot be resolved or the `?restore` re-import fails, the
 * registration (or the afterAll hook) throws and the test file fails loudly
 * instead of silently leaving the mock behind.
 */
export function queueModuleRestore(specifier: string, importerDir: string): void {
  const modulePath = Bun.resolveSync(specifier, importerDir).replace(/\\/g, '/');
  afterAll(async () => {
    const realModule = await import(`${modulePath}?restore`);
    mock.module(modulePath, () => realModule);
  });
}
