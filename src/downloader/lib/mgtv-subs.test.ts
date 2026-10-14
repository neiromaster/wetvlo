import { describe, expect, it } from 'bun:test';
import type { MgtvSubtitleEntry } from './mgtv-api';
import { langTag, matchSubLangs } from './mgtv-subs';

function entry(code: string, name = code): MgtvSubtitleEntry {
  return { name, code, url: `/vod.do?${code}` };
}

const ALL = [entry('EN', 'English'), entry('RU', 'Русский'), entry('ZH_CN', '简体中文'), entry('ZH_HK', '繁體中文')];

describe('matchSubLangs', () => {
  it('ru.* matches RU', () => {
    expect(matchSubLangs(ALL, ['ru.*'])).toEqual([entry('RU', 'Русский')]);
  });

  it('en.* matches EN', () => {
    expect(matchSubLangs(ALL, ['en.*'])).toEqual([entry('EN', 'English')]);
  });

  it('zh.* matches both ZH_CN and ZH_HK (prefix match)', () => {
    expect(matchSubLangs(ALL, ['zh.*'])).toEqual([entry('ZH_CN', '简体中文'), entry('ZH_HK', '繁體中文')]);
  });

  it('zho.* intentionally matches nothing (MGTV uses zh_* codes)', () => {
    expect(matchSubLangs(ALL, ['zho.*'])).toEqual([]);
  });

  it('a pattern without * requires an exact match', () => {
    expect(matchSubLangs(ALL, ['ru'])).toEqual([entry('RU', 'Русский')]);
    expect(matchSubLangs(ALL, ['zh'])).toEqual([]);
  });

  it('combines patterns and dedupes nothing (entries are unique already)', () => {
    expect(matchSubLangs(ALL, ['ru.*', 'zh_hk'])).toEqual([entry('RU', 'Русский'), entry('ZH_HK', '繁體中文')]);
  });

  it('empty pattern list matches nothing', () => {
    expect(matchSubLangs(ALL, [])).toEqual([]);
  });

  it('is case-insensitive on both sides', () => {
    expect(matchSubLangs(ALL, ['RU.*'])).toEqual([entry('RU', 'Русский')]);
  });
});

describe('langTag', () => {
  it('lowercases the code for filename suffixes', () => {
    expect(langTag(entry('RU'))).toBe('ru');
    expect(langTag(entry('ZH_CN'))).toBe('zh_cn');
  });
});
