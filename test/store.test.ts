import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { runIndex, runSearch } from '../src/cli/commands.js';
import { loadConfig, parseConfig } from '../src/config/index.js';
import { ConfigError, StoreError } from '../src/errors.js';
import { indexRepo } from '../src/indexer/index.js';
import { ftsQuery, search, symbolCandidates } from '../src/retriever/index.js';
import { expandTerms, identifierParts } from '../src/store/fts.js';
import { Store } from '../src/store/index.js';

/** A private copy of a fixture repo, so tests can edit files and create `.codemem/`. */
function copyFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `codemem-${name}-`));
  cpSync(`test/fixtures/${name}`, root, { recursive: true });
  return root;
}

async function indexed(name: string): Promise<{ root: string; store: Store }> {
  const root = copyFixture(name);
  const store = new Store(join(root, 'index.db'));
  await indexRepo(root, store, parseConfig({ exclude: ['index.db*'] }));
  return { root, store };
}

const names = (store: Store, query: string, k = 10): (string | null)[] =>
  search(store, query, { k }).map((r) => r.chunk.symbol);

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

test('an exact function name returns that function first', async () => {
  const { store } = await indexed('ts-app');
  for (const name of ['authenticateUser', 'findUser', 'parseToken', 'hash', 'UserService.login']) {
    expect(names(store, name)[0], name).toBe(name);
  }
  const first = search(store, 'authenticateUser')[0];
  expect(first?.reasons).toEqual(['exact-symbol', 'keyword']);
  expect(first?.chunk).toMatchObject({ path: 'src/auth.ts', startLine: 10, endLine: 23 });
  store.close();

  const py = await indexed('py-pkg');
  expect(names(py.store, 'validate_sku')[0]).toBe('Order.validate_sku');
  // A nested function has no chunk of its own: the search lands on the function around it.
  expect(names(py.store, 'wrapper')[0]).toBe('retry');
  py.store.close();

  const go = await indexed('go-mod');
  expect(names(go.store, 'Store.Get')[0]).toBe('Store.Get');
  expect(names(go.store, 'normalize')[0]).toBe('normalize');
  go.store.close();
});

test('"user auth" finds authenticateUser through identifier parts and prefixes', async () => {
  const { store } = await indexed('ts-app');
  expect(names(store, 'user auth')[0]).toBe('authenticateUser');
  expect(names(store, 'reset password', 3)).toContain('resetPassword');
  expect(search(store, 'zzzznothing')).toEqual([]);
  expect(search(store, '?? !!')).toEqual([]);
  store.close();
});

test('re-running the index on unchanged files does no work', async () => {
  const { root, store } = await indexed('ts-app');
  const config = parseConfig({ exclude: ['index.db*'] });
  const before = store.counts();
  expect(before).toEqual({ files: 7, symbols: 32, chunks: 38 });

  const again = await indexRepo(root, store, config);
  expect(again).toMatchObject({ scanned: 7, indexed: 0, unchanged: 7, deleted: 0, chunks: 0 });
  expect(store.counts()).toEqual(before);

  // Editing one file reindexes only that file, and the old content stops matching.
  writeFileSync(
    join(root, 'src/hash.ts'),
    'export function digestPassword(): string {\n  return "";\n}\n',
  );
  const edited = await indexRepo(root, store, config);
  expect(edited).toMatchObject({ indexed: 1, unchanged: 6, deleted: 0 });
  expect(names(store, 'digestPassword')[0]).toBe('digestPassword');
  expect(names(store, 'SALT')).toEqual([]);

  // Removing a file removes its chunks and search entries.
  rmSync(join(root, 'src/legacy.js'));
  const removed = await indexRepo(root, store, config);
  expect(removed).toMatchObject({ scanned: 6, indexed: 0, deleted: 1 });
  expect(search(store, 'oldLogin').map((r) => r.chunk.path)).not.toContain('src/legacy.js');
  expect(store.counts().files).toBe(6);

  const full = await indexRepo(root, store, config, { full: true });
  expect(full).toMatchObject({ indexed: 6, unchanged: 0 });
  expect(store.counts().files).toBe(6);
  store.close();
});

test('the schema version is recorded, data survives reopening, and newer schemas are refused', async () => {
  const { root, store } = await indexed('go-mod');
  const counts = store.counts();
  expect(store.getMeta('schema_version')).toBe('1');
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

test('config: defaults, include and exclude globs, and clear errors', async () => {
  expect(parseConfig({})).toEqual({ include: [], exclude: [], maxFileSizeKb: 512 });
  expect(() => parseConfig({ maxFileSizeKb: -1 })).toThrow(ConfigError);
  expect(() => parseConfig({ exclud: [] })).toThrow(/exclud/);

  const root = copyFixture('ts-app');
  expect(loadConfig(root)).toEqual(parseConfig({}));
  expect(await runIndex(root, {})).toMatch(/^Indexed 7 of 7 files/);
  writeFileSync(
    join(root, '.codemem/config.json'),
    '{ "include": ["src/**"], "exclude": ["**/*.js"] }',
  );
  // The config change drops the SQL file and the JavaScript file from the index.
  expect(await runIndex(root, {})).toMatch(/^Indexed 0 of 5 files \(5 unchanged, 2 removed\)/);
  writeFileSync(join(root, '.codemem/config.json'), '{ not json');
  expect(() => loadConfig(root)).toThrow(ConfigError);
});

test('CLI search prints ranked results and explains a missing index', async () => {
  const root = copyFixture('py-pkg');
  expect(() => runSearch(root, 'charge', {})).toThrow(/codemem index/);
  await runIndex(root, {});
  const out = runSearch(root, 'charge', { k: 2, debug: true });
  expect(out.split('\n')[0]).toMatch(
    /^1\. shop\/payments\.py:11-16 {2}function charge {2}\[exact-symbol, keyword\] {2}score=\d/,
  );
  expect(out.split('\n')[1]).toBe('   def charge(amount, token):');
  expect(runSearch(root, 'zzzznothing', {})).toBe('No results.');
});
