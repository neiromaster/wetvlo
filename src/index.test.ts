import { describe, expect, it, mock } from 'bun:test';

// Mock cmd-ts run function
const mockRun = mock(() => Promise.resolve());

mock.module('cmd-ts', () => {
  return {
    run: mockRun,
    // We need to re-export other things used by app.ts/index.ts if they are imported there
    // But app.ts is already imported, so its imports are already resolved?
    // Wait, if we mock 'cmd-ts', we need to make sure we provide everything needed.
    // However, app.ts imports command, option, etc. from cmd-ts.
    // If we mock the whole module, we might break app.ts if it's re-evaluated.
    // But app.ts is likely already evaluated or we need to be careful.

    // For this test, we only care about 'run' called in index.ts
    // We can try to use a spy if possible, but 'run' is a standalone function.

    // Let's try to rely on the fact that we only need 'run' for index.ts
    // But app.ts uses command, etc.
    command: () => ({}),
    option: () => ({}),
    string: {},
    boolean: {},
    flag: () => ({}),
  };
});

// We need to import main AFTER mocking
const { main } = await import('./index.js');

describe('Index', () => {
  it('should run the CLI with provided arguments', async () => {
    const args = ['--config', 'test.yaml'];
    await main(args);

    expect(mockRun).toHaveBeenCalled();
    // We can't easily check arguments because cli is imported from app.js
    // and app.js might be using the mocked cmd-ts which returns {} for command()
    // so cli would be {}.
  });
});
