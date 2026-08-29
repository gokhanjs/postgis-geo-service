import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration suite drives one shared server process against one
    // database, so parallel files would race on the same rows.
    fileParallelism: false,
    globalSetup: ['test/helpers/global-setup.ts'],
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**', 'server.js'],
      reporter: ['text', 'lcov'],
    },
  },
});
