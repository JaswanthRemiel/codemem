import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, type Config } from '../src/config/index.js';
import type { EmbeddingProvider } from '../src/embedder/index.js';
import { indexRepo } from '../src/indexer/index.js';
import { search } from '../src/retriever/index.js';
import { Store } from '../src/store/index.js';

/** Keyword-only config that keeps the test database out of the index. */
export const TEST_CONFIG: Config = parseConfig({
  exclude: ['index.db*'],
  embedding: { provider: 'none' },
});

/** A private copy of a fixture repo, so tests can edit files and create `.codemem/`. */
export function copyFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `codemem-${name}-`));
  cpSync(`test/fixtures/${name}`, root, { recursive: true });
  return root;
}

export async function indexed(
  name: string,
  provider: EmbeddingProvider | null = null,
): Promise<{ root: string; store: Store }> {
  const root = copyFixture(name);
  const store = new Store(join(root, 'index.db'));
  await indexRepo(root, store, TEST_CONFIG, { provider });
  return { root, store };
}

/** Symbol names of the keyword-only results for a query. */
export async function names(store: Store, query: string, k = 10): Promise<(string | null)[]> {
  const results = await search(store, query, TEST_CONFIG.retrieval, null, k);
  return results.map((r) => r.chunk.symbol);
}

/**
 * A deterministic stand-in for an embedding model: a bag-of-words vector. Texts that share
 * words get similar vectors, which is enough to test caching, storage, and fusion.
 */
export function fakeProvider(
  id = 'fake:bag-of-words',
  dim = 32,
): EmbeddingProvider & {
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    id,
    local: true,
    calls,
    async embed(texts) {
      calls.push(texts);
      return texts.map((text) => {
        const vector = new Float32Array(dim);
        for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
          let h = 0;
          for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % dim;
          vector[h] = (vector[h] ?? 0) + 1;
        }
        const norm = Math.hypot(...vector) || 1;
        return vector.map((x) => x / norm);
      });
    },
  };
}
