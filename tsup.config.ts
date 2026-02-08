import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  minify: true,
  target: 'node22',
  outDir: 'dist',
  clean: true,
  bundle: true,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
