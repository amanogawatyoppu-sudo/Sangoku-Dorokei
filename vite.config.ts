import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  // three.js alone is ~550 kB minified; a single game bundle is expected.
  build: { chunkSizeWarningLimit: 900 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
