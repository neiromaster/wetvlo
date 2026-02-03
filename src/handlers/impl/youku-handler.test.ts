import { expect, test } from 'bun:test';
import { YoukuHandler } from './youku-handler';

test('YoukuHandler: extract all episodes from page using Playwright', async () => {
  const handler = new YoukuHandler();

  const url = 'https://www.youku.tv/v/v_show/id_XNjQ3MzIwNzE1Mg==.html';
  const episodes = await handler.extractEpisodes(url);

  console.log(`Found ${episodes.length} episodes:`);
  episodes.slice(0, 5).forEach((ep) => {
    console.log(`  Episode ${ep.number}: ${ep.title}`);
    console.log(`    URL: ${ep.url}`);
    console.log(`    Type: ${ep.type}`);
  });

  if (episodes.length > 5) {
    console.log(`  ... and ${episodes.length - 5} more`);
  }

  // Should find all 40 episodes (35 from page + 5 from API)
  expect(episodes.length).toBeGreaterThanOrEqual(40);

  // First episode should be number 1
  expect(episodes[0]?.number).toBe(1);
  expect(episodes[0]?.url).toContain('youku.tv');

  // Episodes should be sorted
  for (let i = 1; i < episodes.length; i++) {
    const current = episodes[i];
    const prev = episodes[i - 1];
    expect(current).toBeDefined();
    expect(prev).toBeDefined();
    if (current && prev) {
      expect(current.number).toBeGreaterThan(prev.number);
    }
  }
}, 30000);

test('YoukuHandler: supports youku.tv URLs', () => {
  const handler = new YoukuHandler();

  expect(handler.supports('https://www.youku.tv/v/v_show/id_XNjQ3MzIwNzE1Mg==.html')).toBe(true);
  expect(handler.supports('https://youku.tv/v/v_show/id_abc123==.html')).toBe(true);
  expect(handler.supports('https://wetv.vip/play/abc')).toBe(false);
  expect(handler.supports('https://iq.com/play/123')).toBe(false);
});

test('YoukuHandler: extractVideoId', () => {
  const handler = new YoukuHandler() as unknown as { extractVideoId: (url: string) => string | null };

  const testUrl = 'https://www.youku.tv/v/v_show/id_XNjQ3MzIwNzE1Mg==.html';
  const videoId = handler.extractVideoId(testUrl);

  expect(videoId).toBe('XNjQ3MzIwNzE1Mg');
});

test('YoukuHandler: getDomain', () => {
  const handler = new YoukuHandler();
  expect(handler.getDomain()).toBe('youku.tv');
});
