import { fileURLToPath } from 'node:url';
import { run } from 'cmd-ts';
import { cli } from './app';

/**
 * Main entry point
 */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  await run(cli, args);
}

// Check if running directly in Node.js or Bun
const isMainModule = import.meta.main || (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url));

if (isMainModule) {
  await main();
}
