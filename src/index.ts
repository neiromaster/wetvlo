import { run } from 'cmd-ts';
import { cli } from './app.js';

/**
 * Main entry point
 */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  await run(cli, args);
}

// Only run if this is the entry point
if (import.meta.main) {
  await main();
}
