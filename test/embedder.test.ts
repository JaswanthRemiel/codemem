import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { parseConfig } from '../src/config/index.js';
import {
  createProvider,
  embedMissing,
  EmbeddingError,
  embeddingText,
  modelCacheDir,
} from '../src/embedder/index.js';
import { ConfigError } from '../src/errors.js';
import { indexRepo } from '../src/indexer/index.js';
import { search } from '../src/retriever/index.js';
import { fakeProvider, indexed, TEST_CONFIG } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('every chunk gets one vector, in batches, and a second run embeds nothing', async () => {
  const provider = fakeProvider();
  const { root, store } = await indexed('ts-app', provider);
  const chunks = store.counts().chunks;
  expect(provider.calls.flat()).toHaveLength(chunks);
  expect(Math.max(...provider.calls.map((batch) => batch.length))).toBe(8);
  // The file path is embedded with the code.
  expect(provider.calls.flat().some((text) => text.startsWith('src/auth.ts\n'))).toBe(true);
  expect(store.embeddingModel()).toBe('fake:bag-of-words');
  expect(store.chunksWithoutVectors()).toEqual([]);

  provider.calls.length = 0;
  const again = await indexRepo(root, store, TEST_CONFIG, { provider });
  expect(again).toMatchObject({ indexed: 0, embedded: 0 });
  expect(provider.calls).toEqual([]);
  store.close();
});

test('the cache: only new text reaches the model, even on a full rebuild', async () => {
  const provider = fakeProvider();
  const { root, store } = await indexed('ts-app', provider);
  const chunks = store.counts().chunks;

  // Appending a function leaves the other chunks of the file unchanged.
  provider.calls.length = 0;
  const path = join(root, 'src/hash.ts');
  writeFileSync(
    path,
    'export const SALT = "fixture-salt";\n\nexport function extra(): number {\n  return 1;\n}\n',
  );
  const edited = await indexRepo(root, store, TEST_CONFIG, { provider });
  expect(edited).toMatchObject({ indexed: 1, embedded: 2, embeddingsCached: 0 });
  expect(provider.calls.flat()).toHaveLength(2);

  provider.calls.length = 0;
  const full = await indexRepo(root, store, TEST_CONFIG, { provider, full: true });
  expect(full.embedded).toBe(store.counts().chunks);
  expect(full.embeddingsCached).toBe(full.embedded);
  expect(provider.calls.flat()).toEqual([]);
  expect(store.counts().chunks).toBe(chunks);
  store.close();
});

test('a different model is refused until a full rebuild, which replaces every vector', async () => {
  const { root, store } = await indexed('go-mod', fakeProvider('fake:small', 16));
  const other = fakeProvider('fake:large', 48);
  await expect(indexRepo(root, store, TEST_CONFIG, { provider: other })).rejects.toThrow(
    /fake:small .* fake:large.*codemem index --full/,
  );
  await expect(search(store, 'get value', TEST_CONFIG.retrieval, other)).rejects.toThrow(
    EmbeddingError,
  );

  const rebuilt = await indexRepo(root, store, TEST_CONFIG, { provider: other, full: true });
  expect(rebuilt.embedded).toBe(store.counts().chunks);
  expect(store.embeddingModel()).toBe('fake:large');
  const [vector] = await other.embed(['get value'], 'query');
  expect(store.vectorSearch(vector as Float32Array, 3)).toHaveLength(3);
  store.close();
});

test('an interrupted run resumes: only chunks without vectors are embedded', async () => {
  const flaky = fakeProvider();
  let calls = 0;
  const failing = {
    ...flaky,
    async embed(texts: string[]) {
      if (++calls === 3) throw new Error('model crashed');
      return flaky.embed(texts, 'document');
    },
  };
  const { store } = await indexed('py-pkg');
  await expect(embedMissing(store, failing, 4)).rejects.toThrow('model crashed');
  expect(store.chunksWithoutVectors().length).toBe(store.counts().chunks - 8);
  const resumed = await embedMissing(store, flaky, 4);
  expect(resumed.embedded).toBe(store.counts().chunks - 8);
  expect(store.chunksWithoutVectors()).toEqual([]);
  store.close();
});

test('hybrid search fuses keyword and vector ranks and reports both reasons', async () => {
  const provider = fakeProvider();
  const { store } = await indexed('ts-app', provider);
  const results = await search(store, 'authenticateUser', TEST_CONFIG.retrieval, provider, 5);
  expect(results[0]?.chunk.symbol).toBe('authenticateUser');
  expect(results[0]?.reasons).toContain('exact-symbol');
  expect(results.some((r) => r.reasons.includes('vector'))).toBe(true);
  for (const r of results) {
    expect(r.reasons.includes('vector')).toBe(r.ranks.vector !== undefined);
    expect(r.reasons.includes('keyword')).toBe(r.ranks.keyword !== undefined);
  }
  // A query with no usable keywords still returns vector results.
  const vectorOnly = await search(store, '?? password ??', TEST_CONFIG.retrieval, provider, 3);
  expect(vectorOnly.length).toBeGreaterThan(0);
  // An index without vectors falls back to keyword search.
  const plain = await indexed('ts-app');
  const fallback = await search(
    plain.store,
    'authenticateUser',
    TEST_CONFIG.retrieval,
    provider,
    3,
  );
  expect(fallback[0]?.reasons).toEqual(['exact-symbol', 'keyword']);
  plain.store.close();
  store.close();
});

test('providers: none disables vectors, local is the default, model ids name the provider', () => {
  const embedding = (raw: object) => parseConfig({ embedding: raw }).embedding;
  expect(createProvider(embedding({ provider: 'none' }))).toBeNull();
  expect(createProvider(embedding({}))).toMatchObject({
    id: 'local:Xenova/all-MiniLM-L6-v2',
    local: true,
  });
  expect(createProvider(embedding({ provider: 'openai' }))).toMatchObject({
    id: 'openai:text-embedding-3-small',
    local: false,
  });
  expect(createProvider(embedding({ provider: 'voyage', model: 'voyage-4' }))?.id).toBe(
    'voyage:voyage-4',
  );
  vi.stubEnv('CODEMEM_CACHE_DIR', '/tmp/somewhere');
  expect(modelCacheDir()).toBe(join('/tmp/somewhere', 'models'));
});

test('remote providers: key from the environment, retries on server errors, clear failures', async () => {
  const voyage = createProvider(parseConfig({ embedding: { provider: 'voyage' } }).embedding);
  if (!voyage) throw new Error('no provider');
  vi.stubEnv('VOYAGE_API_KEY', '');
  await expect(voyage.embed(['x'], 'query')).rejects.toThrow(ConfigError);

  vi.stubEnv('VOYAGE_API_KEY', 'test-key');
  const requests: { url: string; init: RequestInit }[] = [];
  const replies = [
    new Response('overloaded', { status: 503 }),
    Response.json({
      data: [
        { index: 1, embedding: [0, 2] },
        { index: 0, embedding: [3, 4] },
      ],
    }),
  ];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return replies.shift() ?? new Response('bad request', { status: 400 });
  });
  vi.useFakeTimers();
  const pending = voyage.embed(['a', 'b'], 'query');
  await vi.runAllTimersAsync();
  const vectors = await pending;
  vi.useRealTimers();

  // Sorted back into input order and scaled to unit length.
  expect(vectors.map((v) => [...v].map((x) => Number(x.toFixed(2))))).toEqual([
    [0.6, 0.8],
    [0, 1],
  ]);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.url).toBe('https://api.voyageai.com/v1/embeddings');
  expect(requests[0]?.init.headers).toMatchObject({ authorization: 'Bearer test-key' });
  expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
    model: 'voyage-code-3',
    input: ['a', 'b'],
    input_type: 'query',
  });

  // A client error is not retried.
  await expect(voyage.embed(['a'], 'document')).rejects.toThrow(/HTTP 400/);
  expect(requests).toHaveLength(3);
});

test('embedding input is path, signature, docstring, then body, with nothing repeated', async () => {
  const { store } = await indexed('ts-app');
  const texts = new Map(
    store.chunksWithoutVectors().map((row) => [row.content, embeddingText(row)]),
  );
  const find = (needle: string): string =>
    [...texts.entries()].find(([content]) => content.includes(needle))?.[1] ?? '';

  // The doc comment sits above the signature in the file; here it comes after it.
  expect(find('export async function authenticateUser').split('\n').slice(0, 5)).toEqual([
    'src/auth.ts',
    'export async function authenticateUser(id: string, password: string): Promise<boolean>',
    'Checks a password against the stored hash.',
    'Returns false for unknown users.',
    '{',
  ]);
  expect(
    find('export async function authenticateUser').match(/function authenticateUser/g),
  ).toHaveLength(1);
  // Overloads: all three signature lines, then the body.
  const overloads = find('strict = true').split('\n');
  expect(overloads.slice(1, 4).every((line) => line.startsWith('export function parseToken'))).toBe(
    true,
  );
  expect(overloads[4]).toBe('{');
  // A chunk without a symbol is the path and its lines.
  expect(find("import hash from './hash'").split('\n')[1]).toBe("import hash from './hash';");
  store.close();

  // A later part of a split function: signature and docstring, then that part's code.
  const py = await indexed('py-pkg');
  const part = py.store
    .chunksWithoutVectors()
    .map((row) => embeddingText(row))
    .find((text) => text.includes('return errors'));
  expect(part?.split('\n').slice(0, 3)).toEqual([
    'shop/orders.py',
    'def validate_order(data):',
    'Return a list of problems with a raw order payload.',
  ]);
  expect(part?.match(/def validate_order/g)).toHaveLength(1);
  py.store.close();
});

test('a doc comment longer than the model input cannot push the signature out', () => {
  const docstring = 'Explains the function at length. '.repeat(100).trim();
  const content = `/** ${docstring} */\nexport function tiny(): number {\n  return 1;\n}`;
  const text = embeddingText({
    path: 'src/tiny.ts',
    content,
    signature: 'export function tiny(): number',
    docstring,
    docLines: 1,
  });
  expect(text.split('\n').slice(0, 2)).toEqual(['src/tiny.ts', 'export function tiny(): number']);
  expect(text.endsWith('{\n  return 1;\n}')).toBe(true);
});
