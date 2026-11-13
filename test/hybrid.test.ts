// Uses the real local embedding model. The first run downloads it (about 23 MB) into the
// model cache, so these tests need network access once.
import { expect, test } from 'vitest';
import { parseConfig } from '../src/config/index.js';
import { createProvider, type EmbeddingProvider } from '../src/embedder/index.js';
import { ftsQuery, search } from '../src/retriever/index.js';
import { indexed, TEST_CONFIG } from './helpers.js';

const provider = createProvider(parseConfig({}).embedding) as EmbeddingProvider;

// Each query describes a function without using any word that appears in it.
const CASES = [
  { fixture: 'ts-app', query: 'confirm sign-in credentials', target: 'authenticateUser' },
  { fixture: 'py-pkg', query: 'take money from a customer', target: 'charge' },
  { fixture: 'go-mod', query: 'fetch an item from the cache', target: 'Store.Get' },
];

test.each(CASES)(
  'a natural-language query with no shared keywords finds $target',
  async ({ fixture, query, target }) => {
    const { store } = await indexed(fixture, provider);
    const results = await search(store, query, TEST_CONFIG.retrieval, provider, 3);
    const hit = results.find((r) => r.chunk.symbol === target);
    expect(hit, `${target} in top 3`).toBeDefined();
    // Keyword search alone does not find it: the match comes from the vector only.
    expect(hit?.reasons).toEqual(['vector']);
    // The exact rank varies between CPU types, because the quantized model rounds differently.
    expect(hit?.ranks.vector).toBeLessThanOrEqual(3);
    const keywordOnly = await search(store, query, TEST_CONFIG.retrieval, null, 50);
    expect(keywordOnly.map((r) => r.chunk.symbol)).not.toContain(target);
    expect(ftsQuery(query)).not.toBe('');
    store.close();
  },
  180_000,
);

test('local vectors are unit length and the same text gives the same vector', async () => {
  const [a, b, c] = await provider.embed(
    ['hash a password', 'hash a password', 'open a file'],
    'document',
  );
  expect(a).toHaveLength(384);
  expect(Math.hypot(...(a as Float32Array))).toBeCloseTo(1, 4);
  expect([...(a as Float32Array)]).toEqual([...(b as Float32Array)]);
  expect([...(a as Float32Array)]).not.toEqual([...(c as Float32Array)]);
  expect(await provider.embed([], 'document')).toEqual([]);
}, 180_000);
