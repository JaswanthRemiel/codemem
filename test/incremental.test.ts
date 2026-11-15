import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import {
  runContext,
  runDoctor,
  runIndex,
  runSearch,
  runStats,
  runWatch,
} from '../src/cli/commands.js';
import { indexRepo } from '../src/indexer/index.js';
import { startWatch } from '../src/indexer/watch.js';
import { createServer } from '../src/mcp/server.js';
import { refreshIndex, type ToolContext } from '../src/mcp/tools.js';
import { formatStats } from '../src/stats/index.js';
import { Store } from '../src/store/index.js';
import { countTokens } from '../src/tokens.js';
import { copyFixture, fakeProvider, indexed, names, TEST_CONFIG } from './helpers.js';

const QUICK = { quick: true } as const;

/** Sets a file's modification time well into the past, as if it had not been touched. */
function backdate(path: string): void {
  const old = new Date(Date.now() - 60_000);
  utimesSync(path, old, old);
}

async function connect(ctx: ToolContext): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([createServer(ctx).connect(serverSide), client.connect(clientSide)]);
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  return (result.content as { text: string }[])[0]?.text ?? '';
}

function useKeywordOnly(root: string): void {
  mkdirSync(join(root, '.codemem'), { recursive: true });
  writeFileSync(join(root, '.codemem/config.json'), '{ "embedding": { "provider": "none" } }');
}

test('a quick run finds edits, new files, and deleted files without a full pass', async () => {
  const { root, store } = await indexed('ts-app');
  expect(await indexRepo(root, store, TEST_CONFIG, QUICK)).toMatchObject({
    indexed: 0,
    deleted: 0,
  });

  writeFileSync(
    join(root, 'src/hash.ts'),
    `${readFileSync(join(root, 'src/hash.ts'), 'utf8')}\nexport function pepper(): string {\n  return 'p';\n}\n`,
  );
  writeFileSync(
    join(root, 'src/fresh.ts'),
    'export function brandNew(): number {\n  return 1;\n}\n',
  );
  rmSync(join(root, 'src/legacy.js'));
  const run = await indexRepo(root, store, TEST_CONFIG, QUICK);
  expect(run).toMatchObject({ indexed: 2, deleted: 1, unchanged: 5 });
  expect((await names(store, 'pepper'))[0]).toBe('pepper');
  expect((await names(store, 'brandNew'))[0]).toBe('brandNew');
  expect(await names(store, 'oldLogin')).not.toContain('oldLogin');
  // The graph followed: the new function is in the outline and the removed caller is gone.
  expect(store.symbolsNamed('LegacyLogin')).toEqual([]);

  // An edit that keeps the size is caught through the modification time.
  writeFileSync(
    join(root, 'src/fresh.ts'),
    'export function brandNew(): number {\n  return 2;\n}\n',
  );
  expect(await indexRepo(root, store, TEST_CONFIG, QUICK)).toMatchObject({ indexed: 1 });
  store.close();
});

test('the limit of a quick run: same size and an old timestamp is taken as unchanged', async () => {
  const { root, store } = await indexed('go-mod');
  const path = join(root, 'store.go');
  // Let the first look age past the margin, then make every file look untouched.
  for (const file of ['store.go', 'go.mod', 'cmd/kv/main.go']) backdate(join(root, file));
  for (const file of ['store.go', 'go.mod', 'cmd/kv/main.go']) store.touchFile(file, Date.now());

  const size = statSync(path).size;
  writeFileSync(
    path,
    readFileSync(path, 'utf8').replace('DefaultCapacity = 16', 'DefaultCapacity = 32'),
  );
  expect(statSync(path).size).toBe(size);
  backdate(path);
  // Size and time say nothing changed, so the quick run does not read the file...
  expect(await indexRepo(root, store, TEST_CONFIG, QUICK)).toMatchObject({
    indexed: 0,
    unchanged: 3,
  });
  // ...and the default run, which hashes every file, does.
  expect(await indexRepo(root, store, TEST_CONFIG)).toMatchObject({ indexed: 1, unchanged: 2 });
  store.close();
});

test('a file modified within two seconds of the last scan is always hashed', async () => {
  const { root, store } = await indexed('go-mod');
  const path = join(root, 'store.go');
  const sameSizeEdit = (from: string, to: string): void => {
    const size = statSync(path).size;
    writeFileSync(path, readFileSync(path, 'utf8').replace(from, to));
    expect(statSync(path).size).toBe(size);
  };
  const setMtime = (offsetMs: number): void => {
    const scannedAt = store.fileStates().get('store.go')?.indexedAt ?? 0;
    const time = new Date(scannedAt + offsetMs);
    utimesSync(path, time, time);
  };

  // Edited in the same second as the scan: same size, and a timestamp just before it.
  sameSizeEdit('DefaultCapacity = 16', 'DefaultCapacity = 32');
  setMtime(-900);
  expect(await indexRepo(root, store, TEST_CONFIG, QUICK)).toMatchObject({ indexed: 1 });

  // At the edge of the window, and just after the scan: still hashed.
  sameSizeEdit('DefaultCapacity = 32', 'DefaultCapacity = 48');
  setMtime(-1900);
  expect(await indexRepo(root, store, TEST_CONFIG, QUICK)).toMatchObject({ indexed: 1 });
  sameSizeEdit('DefaultCapacity = 48', 'DefaultCapacity = 64');
  setMtime(300);
  expect(await indexRepo(root, store, TEST_CONFIG, QUICK)).toMatchObject({ indexed: 1 });

  // An unchanged file inside the window is hashed, found equal, and left alone.
  setMtime(-500);
  expect(await indexRepo(root, store, TEST_CONFIG, QUICK)).toMatchObject({
    indexed: 0,
    unchanged: 3,
  });
  store.close();
});

test('codemem search and codemem context pick up changed files before answering', async () => {
  const root = copyFixture('py-pkg');
  useKeywordOnly(root);
  await runIndex(root, {});
  writeFileSync(
    join(root, 'shop/loyalty.py'),
    'def award_points(order):\n    return len(order.items)\n',
  );
  // No `codemem index` in between.
  expect(await runSearch(root, 'award_points', { k: 1 })).toContain(
    '--- shop/loyalty.py:1-2 function award_points [exact-symbol, keyword]',
  );
  writeFileSync(
    join(root, 'shop/loyalty.py'),
    'def award_bonus(order):\n    return 2 * len(order.items)\n',
  );
  const context = await runContext(root, 'award_bonus', { budget: 300 });
  expect(context).toContain('def award_bonus(order):');
  expect(context).not.toContain('award_points');
  rmSync(join(root, 'shop/loyalty.py'));
  expect(await runSearch(root, 'award_bonus', { k: 3 })).not.toContain('shop/loyalty.py');
});

test('index --full prunes cached vectors that no chunk uses any more', async () => {
  const provider = fakeProvider();
  const { root, store } = await indexed('ts-app', provider);
  const chunks = store.counts().chunks;
  expect(store.embeddingCacheSize()).toBe(chunks);

  // Rewriting a file leaves the vectors of its old chunks behind in the cache.
  writeFileSync(join(root, 'src/hash.ts'), 'export function digest(): string {\n  return "";\n}\n');
  await indexRepo(root, store, TEST_CONFIG, { provider });
  expect(store.embeddingCacheSize()).toBeGreaterThan(store.counts().chunks);

  provider.calls.length = 0;
  await indexRepo(root, store, TEST_CONFIG, { provider, full: true });
  expect(store.embeddingCacheSize()).toBe(store.counts().chunks);
  // Pruning did not cost any re-embedding.
  expect(provider.calls.flat()).toEqual([]);
  expect(store.vectorCount()).toBe(store.counts().chunks);
  store.close();
});

test('a tool call re-indexes changed files first, so agents never get stale code', async () => {
  const { root, store } = await indexed('py-pkg');
  const ctx: ToolContext = { root, config: TEST_CONFIG, store, provider: null };
  const client = await connect(ctx);
  expect(await call(client, 'get_symbol', { name: 'refund' })).toMatch(/^No symbol named "refund"/);

  writeFileSync(
    join(root, 'shop/refunds.py'),
    'from .payments import charge\n\n\ndef refund(amount, token):\n    return charge(-amount, token)\n',
  );
  const symbol = await call(client, 'get_symbol', { name: 'refund' });
  expect(symbol).toContain('--- shop/refunds.py:4-5 function refund');
  expect(symbol).toContain('Calls:\n  charge  shop/payments.py:11-16  [import]');
  expect(symbol).not.toContain('index refresh still running');

  rmSync(join(root, 'shop/refunds.py'));
  expect(await call(client, 'search_code', { query: 'refund' })).not.toContain('shop/refunds.py');
  // index_status is the one tool that does not refresh: it reports what is pending.
  writeFileSync(join(root, 'shop/later.py'), 'def later():\n    pass\n');
  expect(await call(client, 'index_status')).toContain(
    'Pending changes: 0 changed, 1 new, 0 deleted',
  );
  store.close();
});

test('a server with no index builds one on the first tool call', async () => {
  const root = copyFixture('go-mod');
  const store = new Store(join(root, 'index.db'));
  const client = await connect({ root, config: TEST_CONFIG, store, provider: null });
  const refs = await call(client, 'find_references', { name: 'normalize' });
  expect(refs).toMatch(/^3 references in 1 file to function normalize/);
  store.close();
});

test('a refresh that exceeds the wait answers from the current index and says so', async () => {
  const slow = fakeProvider();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((done) => (release = done));
  const provider = {
    ...slow,
    async embed(texts: string[], kind: 'document' | 'query') {
      if (kind === 'document') await gate;
      return slow.embed(texts, kind);
    },
  };
  const { root, store } = await indexed('ts-app');
  const ctx: ToolContext = { root, config: TEST_CONFIG, store, provider };

  // A changed file needs new vectors, and the model is held back, so the refresh cannot
  // finish in time.
  writeFileSync(
    join(root, 'src/slow.ts'),
    'export function slowToEmbed(): number {\n  return 1;\n}\n',
  );
  await refreshIndex(ctx, 50);
  expect(ctx.refreshPending).toBe(true);
  const client = await connect(ctx);
  const text = await call(client, 'get_context', { task: 'authenticateUser', budget_tokens: 300 });
  expect(text.split('\n').at(-1)).toBe(
    '(index refresh still running: results may not include your latest edits)',
  );
  expect(text).toContain('function authenticateUser');
  // The note is paid for out of the budget.
  expect(countTokens(text)).toBeLessThanOrEqual(300);

  // Once the refresh completes, answers are complete again and say nothing.
  release();
  await ctx.refreshing;
  expect(ctx.refreshPending).toBe(false);
  expect(await call(client, 'get_context', { task: 'authenticateUser' })).not.toContain('refresh');
  expect(store.vectorCount()).toBe(store.counts().chunks);
  store.close();
}, 30_000);

test('every tool call is logged, and stats compares tokens served with the baseline', async () => {
  const { root, store } = await indexed('ts-app');
  expect(formatStats(store)).toMatch(/^No queries logged yet/);
  const client = await connect({ root, config: TEST_CONFIG, store, provider: null });
  await call(client, 'get_context', {
    task: 'authenticateUser password check',
    budget_tokens: 300,
  });
  await call(client, 'search_code', { query: 'findUser', k: 1 });
  await call(client, 'get_symbol', { name: 'hash', include: 'signature', depth: 0 });
  await call(client, 'get_file_outline', { path: 'src/service.ts' });
  await call(client, 'find_references', { name: 'findUser' });

  const rows = store.queryLogSummary();
  expect(rows.map((r) => r.tool).sort()).toEqual([
    'find_references',
    'get_context',
    'get_file_outline',
    'get_symbol',
    'search_code',
  ]);
  for (const row of rows) {
    expect(row.queries).toBe(1);
    expect(row.tokensReturned).toBeGreaterThan(0);
    // The baseline is never smaller than what was served.
    expect(row.baselineTokens).toBeGreaterThanOrEqual(row.tokensReturned);
  }
  const by = Object.fromEntries(rows.map((r) => [r.tool, r]));
  // A signature costs less than reading hash.ts; an outline less than reading service.ts.
  expect(by['get_symbol']?.baselineTokens).toBeGreaterThan(by['get_symbol']?.tokensReturned ?? 0);
  expect(by['get_file_outline']?.baselineTokens).toBeGreaterThan(
    by['get_file_outline']?.tokensReturned ?? 0,
  );
  // A tool that returns no code claims no saving.
  expect(by['find_references']?.baselineTokens).toBe(by['find_references']?.tokensReturned);

  const report = formatStats(store).split('\n');
  expect(report[0]).toMatch(/^Queries served: 5 since \d{4}-\d\d-\d\d$/);
  expect(report[1]).toMatch(/^Tokens served: ~[\d,]+$/);
  expect(report[2]).toMatch(/^Estimated baseline: ~[\d,]+ tokens \(reading in full every file/);
  expect(report[3]).toMatch(/^Estimated saving: up to ~[\d,]+ tokens \(\d+%\)$/);
  expect(report.join('\n')).toContain('the baseline is an estimate, not a measurement');
  store.close();
});

test('codemem stats and context work from the command line', async () => {
  const root = copyFixture('go-mod');
  expect(() => runStats(root)).toThrow(/codemem index/);
  useKeywordOnly(root);
  await runIndex(root, {});
  expect(runStats(root)).toMatch(/^No queries logged yet/);
  await runContext(root, 'normalize a key', { budget: 300 });
  expect(runStats(root)).toMatch(/^Queries served: 1 /);
  const { lines } = await runDoctor(root);
  expect(lines.at(-1)).toBe('Index: 3 files, 15 chunks, 0 pending changes, no vectors');
});

test('watch re-indexes after files change, once the changes settle', async () => {
  const { root, store } = await indexed('py-pkg');
  const config = { ...TEST_CONFIG, watch: { debounceMs: 100 } };
  const runs: number[] = [];
  let notify: () => void = () => undefined;
  const watcher = startWatch(root, store, config, null, (stats) => {
    runs.push(stats.indexed);
    notify();
  });
  const nextRun = (): Promise<void> => new Promise((done) => (notify = done));
  // Give the watcher time to start listening before the first change.
  await new Promise((done) => setTimeout(done, 500));

  const first = nextRun();
  writeFileSync(
    join(root, 'shop/coupons.py'),
    'def apply_coupon(order, code):\n    return order\n',
  );
  writeFileSync(join(root, 'shop/gifts.py'), 'def wrap_gift(order):\n    return order\n');
  await first;
  // Two files written together are picked up by one run.
  expect(runs).toEqual([2]);
  expect((await names(store, 'apply_coupon'))[0]).toBe('apply_coupon');

  const second = nextRun();
  rmSync(join(root, 'shop/gifts.py'));
  await second;
  expect(store.symbolsNamed('wrap_gift')).toEqual([]);
  await watcher.close();
  store.close();
}, 30_000);

test('codemem watch indexes first, reports, and stops cleanly', async () => {
  const root = copyFixture('go-mod');
  useKeywordOnly(root);
  const lines: string[] = [];
  const stop = await runWatch(root, (line) => lines.push(line));
  expect(lines[0]).toMatch(/^Indexed 3 of 3 files/);
  expect(lines[1]).toMatch(/^Watching .* for changes\. Press Ctrl\+C to stop\.$/);
  await stop();
}, 30_000);
