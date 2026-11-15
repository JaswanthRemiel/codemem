import { defineConfig } from 'vitest/config';

// The core modules must stay at 80% line coverage or better.
const core = { lines: 80 };

export default defineConfig({
  test: {
    // CI runners are several times slower than a laptop; the 5-second default caused
    // intermittent failures in tests that index a fixture or spawn git.
    testTimeout: 30_000,
    coverage: {
      include: ['src/**/*.ts'],
      reporter: ['text'],
      thresholds: {
        'src/parser/**': core,
        'src/chunker/**': core,
        'src/retriever/**': core,
        'src/packer/**': core,
        'src/graph/**': core,
        'src/memory/**': core,
      },
    },
  },
});
