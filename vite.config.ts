/// <reference types="vitest/config" />
import { configDefaults } from 'vitest/config';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any folder (GitHub Pages, itch.io, file hosts).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
  },
  test: {
    // Work-in-progress checkouts under .claude/ are not part of this one.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
