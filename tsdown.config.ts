import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  sourcemap: true,
  minify: true,
  target: 'node22',
  outDir: 'dist',
  clean: true,
  unbundle: false,
  banner: '#!/usr/bin/env node',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
});
