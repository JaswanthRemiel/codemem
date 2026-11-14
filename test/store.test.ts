import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { runIndex, runSearch } from '../src/cli/commands.js';
import { loadConfig, parseConfig } from '../src/config/index.js';
import { ConfigError, StoreError } from '../src/errors.js';
import { indexRepo } from '../src/indexer/index.js';
import { ftsQuery, fuse, search, symbolCandidates } from '../src/retriever/index.js';
import { expandTerms, identifierParts } from '../src/store/fts.js';
import { Store } from '../src/store/index.js';
import { copyFixture, indexed, names, TEST_CONFIG } from './helpers.js';

const EMBEDDINGS_OFF = '"embedding": { "provider": "none" }';

function writeConfig(root: string, json: string): void {
  mkdirSync(join(root, '.codemem'), { recursive: true });
  writeFileSync(join(root, '.codemem/config.json'), json);
}

test('identifiers are split on camelCase, acronyms, digits, and underscores', () => {
  expect(identifierParts('authenticateUser')).toEqual(['authenticate', 'user']);
  expect(identifierParts('parseHTTPResponse')).toEqual(['parse', 'http', 'response']);
  expect(identifierParts('find_user_by_id')).toEqual(['find', 'user', 'by', 'id']);
  expect(identifierParts('__init__')).toEqual(['init']);
  expect(identifierParts('MAX_RETRIES')).toEqual(['max', 'retries']);
  expect(expandTerms('const x = findUser(id);')).toEqual([
    'const',
    'x',
    'finduser',
    'find',
    'user',
    'id',
  ]);
});

test('queries drop stopwords, prefix-match longer terms, and pick identifier-like symbols', () => {
  expect(ftsQuery('where is the user auth')).toBe('"user"* OR "auth"*');
  expect(ftsQuery('findUser id')).toBe('"finduser"* OR "find"* OR "user"* OR "id"');
  expect(ftsQuery('the of ???')).toBe('');
  expect(symbolCandidates('resolve')).toEqual(['resolve']);
  expect(symbolCandidates('how to resolve a route')).toEqual([]);
  expect(symbolCandidates('fix findUser and UserService.login')).toEqual([
    'findUser',
    'UserService.login',
    'login',
  ]);
});

test('reciprocal rank fusion rewards agreement between lists', () => {
  const scores = fuse(
    [
      [1, 2, 3],
      [3, 4],
    ],
    60,
  );
  expect(scores.get(3)).toBeCloseTo(1 / 63 + 1 / 61);
  expect(scores.get(1)).toBeCloseTo(1 / 61);
  // Third in one list and first in the other beats first in a single list.
  expect([...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]).toBe(3);
});

test('an exact function name returns that function first', async () => {
  const { store } = await indexed('ts-app');
  for (const name of ['authenticateUser', 'findUser', 'parseToken', 'hash', 'UserService.login']) {
    expect((await names(store, name))[0], name).toBe(name);
  }
  const first = (await search(store, 'authenticateUser', TEST_CONFIG.retrieval, null))[0];
  expect(first?.reasons.slice(0, 2)).toEqual(['exact-symbol', 'keyword']);
  expect(first?.ranks).toEqual({ keyword: 1 });
  expect(first?.chunk).toMatchObject({ path: 'src/auth.ts', startLine: 10, endLine: 23 });
  store.close();

  const py = await indexed('py-pkg');
  expect((await names(py.store, 'validate_sku'))[0]).toBe('Order.validate_sku');
  // A nested function has no chunk of its own: the search lands on the function around it.
  expect((await names(py.store, 'wrapper'))[0]).toBe('retry');
  py.store.close();

  const go = await indexed('go-mod');
  expect((await names(go.store, 'Store.Get'))[0]).toBe('Store.Get');
  expect((await names(go.store, 'normalize'))[0]).toBe('normalize');
  go.store.close();
});

test('"user auth" finds authenticateUser through identifier parts and prefixes', async () => {
  const { store } = await indexed('ts-app');
  expect((await names(store, 'user auth'))[0]).toBe('authenticateUser');
  expect(await names(store, 'reset password', 3)).toContain('resetPassword');
  expect(await names(store, 'zzzznothing')).toEqual([]);
  expect(await names(store, '?? !!')).toEqual([]);
  store.close();
});

test('re-running the index on unchanged files does no work', async () => {
  const { root, store } = await indexed('ts-app');
  const before = store.counts();
  expect(before).toEqual({ files: 7, symbols: 32, chunks: 38 });

  const again = await indexRepo(root, store, TEST_CONFIG);
  expect(again).toMatchObject({ scanned: 7, indexed: 0, unchanged: 7, deleted: 0, chunks: 0 });
  expect(store.counts()).toEqual(before);

  // Editing one file reindexes only that file, and the old content stops matching.
  writeFileSync(
    join(root, 'src/hash.ts'),
    'export function digestPassword(): string {\n  return "";\n}\n',
  );
  const edited = await indexRepo(root, store, TEST_CONFIG);
  expect(edited).toMatchObject({ indexed: 1, unchanged: 6, deleted: 0 });
  expect((await names(store, 'digestPassword'))[0]).toBe('digestPassword');
  expect(await names(store, 'SALT')).toEqual([]);

  // Removing a file removes its chunks and search entries.
  rmSync(join(root, 'src/legacy.js'));
  const removed = await indexRepo(root, store, TEST_CONFIG);
  expect(removed).toMatchObject({ scanned: 6, indexed: 0, deleted: 1 });
  const hits = await search(store, 'oldLogin', TEST_CONFIG.retrieval, null);
  expect(hits.map((r) => r.chunk.path)).not.toContain('src/legacy.js');
  expect(store.counts().files).toBe(6);

  const full = await indexRepo(root, store, TEST_CONFIG, { full: true });
  expect(full).toMatchObject({ indexed: 6, unchanged: 0 });
  expect(store.counts().files).toBe(6);
  store.close();
});

test('the schema version is recorded, data survives reopening, and newer schemas are refused', async () => {
  const { root, store } = await indexed('go-mod');
  const counts = store.counts();
  expect(store.getMeta('schema_version')).toBe('4');
  expect(store.getChunks([1])[0]?.tokenCount).toBeGreaterThan(0);
  store.setMeta('schema_version', '999');
  store.close();
  expect(() => new Store(join(root, 'index.db'))).toThrow(StoreError);

  const other = await indexed('go-mod');
  other.store.close();
  const reopened = new Store(join(other.root, 'index.db'));
  expect(reopened.counts()).toEqual(counts);
  reopened.close();
});

test('config: every default, nested overrides, and clear errors', () => {
  expect(parseConfig({})).toEqual({
    include: [],
    exclude: [],
    maxFileSizeKb: 512,
    embedding: { provider: 'local', model: '', batchSize: 8, maxTokens: 256 },
    retrieval: {
      rrfK: 60,
      keywordLimit: 50,
      vectorLimit: 50,
      keywordWeights: { content: 1, symbol: 5, path: 2 },
      defaultK: 10,
      defaultBudgetTokens: 4000,
      contextK: 20,
      memoryLimit: 5,
      memoryMinSimilarity: 0.3,
      memoryMinKeywordMatch: 0.5,
      graphTopN: 10,
      graphMaxNeighbors: 20,
      edgeWeights: { exact: 0.5, import: 0.4, 'name-match': 0.2 },
    },
  });
  const custom = parseConfig({ retrieval: { rrfK: 30, edgeWeights: { exact: 0.9 } } });
  expect(custom.retrieval).toMatchObject({
    rrfK: 30,
    keywordLimit: 50,
    edgeWeights: { exact: 0.9, import: 0.4, 'name-match': 0.2 },
  });
  expect(() => parseConfig({ maxFileSizeKb: -1 })).toThrow(ConfigError);
  expect(() => parseConfig({ exclud: [] })).toThrow(/exclud/);
  expect(() => parseConfig({ retrieval: { rrfk: 30 } })).toThrow(/rrfk/);
  expect(() => parseConfig({ embedding: { provider: 'azure' } })).toThrow(ConfigError);
});

test('config file: include and exclude globs change what is indexed', async () => {
  const root = copyFixture('ts-app');
  expect(loadConfig(root)).toEqual(parseConfig({}));
  writeConfig(root, `{ ${EMBEDDINGS_OFF} }`);
  expect(await runIndex(root, {})).toMatch(/^Indexed 7 of 7 files .* Embeddings are off\./);
  // The config change drops the SQL file and the JavaScript file from the index.
  writeConfig(root, `{ "include": ["src/**"], "exclude": ["**/*.js"], ${EMBEDDINGS_OFF} }`);
  expect(await runIndex(root, {})).toMatch(/^Indexed 0 of 5 files \(5 unchanged, 2 removed\)/);
  writeConfig(root, '{ not json');
  expect(() => loadConfig(root)).toThrow(ConfigError);
});

test('CLI search prints packed results, scores with --debug, and explains a missing index', async () => {
  const root = copyFixture('py-pkg');
  await expect(runSearch(root, 'charge', {})).rejects.toThrow(/codemem index/);
  writeConfig(root, `{ ${EMBEDDINGS_OFF} }`);
  await runIndex(root, {});
  const out = (await runSearch(root, 'charge', { k: 2 })).split('\n');
  const block = out.indexOf('--- shop/payments.py:11-16 function charge [exact-symbol, keyword]');
  expect(block).toBeGreaterThanOrEqual(0);
  expect(out[block + 1]).toBe('def charge(amount, token):');
  // Two search results plus the graph neighbors of `charge`.
  expect(out.at(-1)).toMatch(/^~\d+ tokens \| \d+ results$/);
  expect(out.join('\n')).toContain('function pay [calls charge] (signature only)');
  const debug = await runSearch(root, 'charge', { k: 2, debug: true });
  expect(debug.split('\n')[0]).toMatch(
    /^1\. score=1\.\d+ keyword=1 vector=- {2}shop\/payments\.py:11-16 charge$/,
  );
  expect(await runSearch(root, 'zzzznothing', {})).toMatch(/^~\d+ tokens \| 0 results$/);
});
