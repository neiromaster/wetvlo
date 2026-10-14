import type { MgtvSubtitleEntry } from './mgtv-api.js';

/**
 * Match subtitle entries against config `subLangs` patterns.
 *
 * Patterns are yt-dlp-style prefix globs compared against MGTV's
 * `captionSimpleName` lowercased (`ru`, `en`, `zh_cn`, `zh_hk`):
 * - `ru.*` / `ru*` → prefix match
 * - `ru` (no asterisk) → exact match
 * - `zho.*` intentionally matches nothing (MGTV uses `zh_*` codes)
 *
 * @param entries - Available subtitle entries from fetchSubtitleList
 * @param subLangs - Config patterns, e.g. ['ru.*', 'en.*', 'zh.*']
 */
export function matchSubLangs(entries: MgtvSubtitleEntry[], subLangs: string[]): MgtvSubtitleEntry[] {
  if (subLangs.length === 0) return [];

  const patterns = subLangs.map((pattern) => {
    const base = pattern.toLowerCase().replace(/\.\*$/, '').replace(/\*$/, '');
    return { base, exact: !pattern.includes('*') };
  });

  return entries.filter((e) => {
    const tag = e.code.toLowerCase();
    if (!tag) return false;
    return patterns.some((p) => (p.exact ? tag === p.base : tag.startsWith(p.base)));
  });
}

/**
 * Filename language tag for a subtitle, e.g. RU → "ru", ZH_CN → "zh_cn".
 */
export function langTag(entry: MgtvSubtitleEntry): string {
  return entry.code.toLowerCase();
}
