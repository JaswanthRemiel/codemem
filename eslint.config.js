import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'graft/', 'coverage/', 'test/fixtures/'] },
  tseslint.configs.strict,
  {
    // Module boundary: only the store talks to SQLite.
    files: ['src/**'],
    ignores: ['src/store/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: ['better-sqlite3'] }],
    },
  },
);
