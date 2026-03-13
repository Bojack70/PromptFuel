import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/postinstall.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  // Bundle everything so the CLI is self-contained
  bundle: true,
  // Treat React JSX correctly
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
});
