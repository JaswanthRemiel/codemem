import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'graft/', 'coverage/', 'test/fixtures/'] },
  tseslint.configs.strict,
);
