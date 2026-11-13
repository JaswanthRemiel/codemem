import { defineConfig } from 'vitest/config';

// The core modules must stay at 80% line coverage or better.
const core = { lines: 80 };

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      reporter: ['text'],
      thresholds: {
        'src/parser/**': core,
        'src/chunker/**': core,
        'src/retriever/**': core,
        'src/packer/**': core,
      },
    },
  },
});
