import { expect, test } from 'vitest';
import { pack, type PackItem } from '../src/packer/index.js';
import { search } from '../src/retriever/index.js';
import type { ChunkRow, Store } from '../src/store/index.js';
import { countTokens } from '../src/tokens.js';
import { indexed, TEST_CONFIG } from './helpers.js';

async function items(store: Store, query: string, k = 10): Promise<PackItem[]> {
  return search(store, query, TEST_CONFIG.retrieval, null, k);
}

/** Every chunk in a store, as low-scored pack items. */
function allItems(store: Store): PackItem[] {
  const ids = Array.from({ length: store.counts().chunks }, (_, i) => i + 1);
  return store.getChunks(ids).map((chunk, i) => ({
    chunk,
    score: 1 / (i + 1),
    reasons: ['keyword'],
    detail: 'full' as const,
  }));
}

test('golden: results grouped by file in line order, with reasons and a footer', async () => {
  const { store } = await indexed('ts-app');
  const packed = pack(await items(store, 'authenticateUser password', 6), 600);
  await expect(packed.text).toMatchFileSnapshot('golden/pack-search.txt');
  expect(packed.tokens).toBe(countTokens(packed.text));
  expect(packed.tokens).toBeLessThanOrEqual(600);
  store.close();
});

test('golden: graph neighbors are compressed to signature and docstring', async () => {
  const { store } = await indexed('ts-app');
  // One search result; everything else in the output is a neighbor from the call graph.
  const packed = pack(await items(store, 'authenticateUser', 1), 600);
  await expect(packed.text).toMatchFileSnapshot('golden/pack-signatures.txt');
  expect(packed.text).toContain('[calls authenticateUser] (signature only)');
  expect(packed.text).toContain('[called by authenticateUser] (signature only)');
  // A signature block carries no body.
  expect(packed.text).not.toContain('this.audit(id, ok)');
  store.close();
});

test('golden: split parts and overlapping windows are joined without repeated lines', async () => {
  const py = await indexed('py-pkg');
  const parts = allItems(py.store).filter((item) => item.chunk.symbol === 'validate_order');
  expect(parts).toHaveLength(2);
  const joined = pack(parts, 4000);
  await expect(joined.text).toMatchFileSnapshot('golden/pack-merged.txt');
  expect(joined.text.split('\n')[0]).toBe(
    '--- shop/orders.py:68-164 function validate_order [keyword]',
  );
  // The signature the second part carries is not repeated inside the joined block.
  expect(joined.text.match(/def validate_order/g)).toHaveLength(1);
  py.store.close();

  const ts = await indexed('ts-app');
  const windows = allItems(ts.store).filter((item) => item.chunk.path === 'db/schema.sql');
  const sql = pack(windows, 4000);
  expect(sql.text.split('\n')[0]).toBe('--- db/schema.sql:1-82 lines [keyword]');
  expect(sql.text.split('\n')).toHaveLength(1 + 82 + 2);
  ts.store.close();
});

test('golden: a tight budget downgrades to signatures, then drops, and says so', async () => {
  const { store } = await indexed('ts-app');
  const packed = pack(await items(store, 'user login password token', 10), 220);
  await expect(packed.text).toMatchFileSnapshot('golden/pack-tight.txt');
  expect(packed.dropped.length).toBeGreaterThan(0);
  expect(packed.text).toMatch(/\| \d+ dropped for budget$/);
  expect(packed.included.some((item) => item.detail === 'signature')).toBe(true);
  expect(packed.tokens).toBeLessThanOrEqual(220);
  store.close();
});

test('a class header and one of its methods are both kept, as separate blocks', async () => {
  const { store } = await indexed('ts-app');
  const chosen = allItems(store).filter((item) =>
    ['UserService', 'UserService.login'].includes(item.chunk.symbol ?? ''),
  );
  const { text } = pack(chosen, 4000);
  expect(text).toContain('--- src/service.ts:22-59 class UserService');
  expect(text).toContain('--- src/service.ts:33-38 method UserService.login');
  expect(text).toContain('await authenticateUser(id, password)');
  store.close();
});

test('edge cases: no items, duplicate items, and budgets too small for anything', async () => {
  expect(pack([], 100).text).toMatch(/^~\d+ tokens \| 0 results$/);
  const { store } = await indexed('go-mod');
  const [first] = allItems(store);
  const twice = pack([first as PackItem, first as PackItem], 4000);
  expect(twice.included).toHaveLength(1);
  // Nothing fits: only the footer, or nothing at all when even the footer is too big.
  const tiny = pack(allItems(store), 30);
  expect(tiny.included).toEqual([]);
  expect(tiny.text).toMatch(/^~\d+ tokens \| 0 results \| \d+ dropped for budget$/);
  expect(pack(allItems(store), 3)).toMatchObject({ text: '', tokens: 0 });
  store.close();
});

test('property: the output never exceeds the budget', async () => {
  const pool: PackItem[] = [];
  for (const fixture of ['ts-app', 'py-pkg', 'go-mod']) {
    const { store } = await indexed(fixture);
    pool.push(...allItems(store).map((item) => ({ ...item, chunk: { ...item.chunk } })));
    store.close();
  }
  // Chunk ids repeat across the three stores; make them unique.
  for (const [i, item] of pool.entries()) item.chunk.id = i + 1;

  // mulberry32: a seeded generator, so a failure can be reproduced from the iteration number.
  let seed = 20261113;
  const random = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const NOISE = ['éè 中文', '\t\t', '{}();', 'x'.repeat(40), '\n\n\n', '--- fake:1-2'];
  const randomChunk = (id: number): ChunkRow => {
    const lineCount = 1 + Math.floor(random() * 30);
    const start = 1 + Math.floor(random() * 500);
    const lines = Array.from(
      { length: lineCount + (random() < 0.2 ? 1 : 0) },
      () => NOISE[Math.floor(random() * NOISE.length)] as string,
    );
    return {
      id,
      symbolId: null,
      path: `gen/file${Math.floor(random() * 3)}.ts`,
      language: 'typescript',
      startLine: start,
      endLine: start + lineCount - 1,
      content: lines.join('\n'),
      tokenCount: 0,
      symbol: random() < 0.5 ? `sym${id}` : null,
      kind: random() < 0.2 ? 'class' : 'function',
      signature: random() < 0.5 ? `function sym${id}(a: string): void` : '',
      docstring: random() < 0.3 ? 'Does a thing.\nSecond line.' : '',
    };
  };

  for (let iteration = 0; iteration < 400; iteration++) {
    const count = Math.floor(random() * 25);
    const chosen: PackItem[] = Array.from({ length: count }, (_, i) => {
      const fromPool = pool[Math.floor(random() * pool.length)] as PackItem;
      const chunk = random() < 0.7 ? fromPool.chunk : randomChunk(100000 + iteration * 100 + i);
      return {
        chunk,
        score: random(),
        reasons: random() < 0.5 ? ['keyword'] : ['keyword', 'vector'],
        detail: random() < 0.3 ? 'signature' : 'full',
      };
    });
    const budget = Math.floor(random() * (random() < 0.5 ? 300 : 5000));
    const result = pack(chosen, budget);
    const context = `iteration ${iteration}, budget ${budget}, ${count} items`;
    expect(countTokens(result.text), context).toBeLessThanOrEqual(budget);
    expect(result.tokens, context).toBe(countTokens(result.text));
    const unique = new Set(chosen.map((item) => item.chunk.id)).size;
    expect(result.included.length + result.dropped.length, context).toBe(unique);
  }
}, 120_000);
