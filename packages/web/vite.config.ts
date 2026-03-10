import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { claudeDataPlugin } from './src/claude-data-api';

export default defineConfig({
  plugins: [react(), claudeDataPlugin()],
  base: './',
  build: {
    outDir: 'dist',
  },
});
