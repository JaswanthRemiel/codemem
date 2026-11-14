import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import { runMemory } from '../src/cli/commands.js';
import { indexRepo } from '../src/indexer/index.js';
import { createServer } from '../src/mcp/server.js';
import {
  forget,
  formatMemory,
  linkedMemories,
  MemoryError,
  recall,
  refreshStaleness,
  remember,
  syncMemories,
} from '../src/memory/index.js';
import { pack } from '../src/packer/index.js';
import { Store } from '../src/store/index.js';
import { countTokens } from '../src/tokens.js';
import { fakeProvider, indexed, TEST_CONFIG } from './helpers.js';

const T = TEST_CONFIG.retrieval;
const mirror = (root: string): string => join(root, '.codemem/memory.json');
const readMirror = (root: string) =>
  JSON.parse(readFileSync(mirror(root), 'utf8')) as {
    version: number;
    memories: {
      id: string;
      kind: string;
      text: string;
      links: { path: string; symbol: string | null }[];
    }[];
  };

async function client(root: string, store: Store): Promise<Client> {
  const server = createServer({ root, config: TEST_CONFIG, store, provider: null });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), c.connect(clientSide)]);
  return c;
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await c.callTool({ name, arguments: args });
  return {
    text: (result.content as { text: string }[])[0]?.text ?? '',
    isError: result.isError === true,
  };
}

test('remember stores a memory, links it to code, and mirrors it to memory.json', async () => {
  const { root, store } = await indexed('ts-app');
  const { memory, unlinked } = remember(root, store, {
    text: '  Passwords are hashed with the fixture salt, never stored in plain text.  ',
    kind: 'decision',
    symbols: ['hash', 'UserService.login'],
    paths: ['./src/db.ts'],
    tags: ['security', 'security'],
  });
  expect(memory.id).toMatch(/^m_[0-9a-f]{8}$/);
  expect(unlinked).toEqual([]);
  expect(memory.text).toBe(
    'Passwords are hashed with the fixture salt, never stored in plain text.',
  );
  expect(memory.tags).toEqual(['security']);
  expect(memory.links.map((l) => `${l.path} ${l.symbol}`)).toEqual([
    'src/db.ts null',
    'src/hash.ts hash',
    'src/service.ts UserService.login',
  ]);
  for (const link of memory.links) expect(link.contentHash).toMatch(/^[0-9a-f]{64}$/);

  const file = readMirror(root);
  expect(file.version).toBe(1);
  expect(file.memories).toHaveLength(1);
  expect(file.memories[0]).toMatchObject({ id: memory.id, kind: 'decision' });
  // Staleness is derived from the code, so it is not written to the shared file.
  expect(file.memories[0]).not.toHaveProperty('stale');
  expect(readFileSync(mirror(root), 'utf8').endsWith('}\n')).toBe(true);
  store.close();
});

test('names that cannot be linked are reported, and the memory is still stored', async () => {
  const { root, store } = await indexed('ts-app');
  writeFileSync(join(root, 'src/other.ts'), 'export function hash(): string {\n  return "";\n}\n');
  await indexRepo(root, store, TEST_CONFIG);
  const { memory, unlinked } = remember(root, store, {
    text: 'Check the notes',
    kind: 'todo',
    symbols: ['hash', 'noSuchThing'],
    paths: ['missing.ts'],
  });
  expect(memory.links).toEqual([]);
  expect(unlinked).toEqual([
    'missing.ts (no such file in the index)',
    'hash (2 symbols have this name; use a qualified name)',
    'noSuchThing (no such symbol in the index)',
  ]);
  expect(store.listMemories()).toHaveLength(1);
  expect(() => remember(root, store, { text: '   ', kind: 'todo' })).toThrow(MemoryError);
  store.close();
});

test('recall finds memories by keyword, filters by kind, and lists everything for an empty query', async () => {
  const { root, store } = await indexed('py-pkg');
  const a = remember(root, store, {
    text: 'Retry payments at most three times.',
    kind: 'convention',
    tags: ['payments'],
  }).memory;
  const b = remember(root, store, {
    text: 'SKUs are always eight characters.',
    kind: 'gotcha',
  }).memory;
  remember(root, store, { text: 'Move notify to a queue.', kind: 'todo' });

  expect((await recall(root, store, null, 'payment retries', T)).map((m) => m.id)).toEqual([a.id]);
  expect((await recall(root, store, null, 'sku length', T))[0]?.id).toBe(b.id);
  // Tags are searchable too.
  expect((await recall(root, store, null, 'payments', T)).map((m) => m.id)).toContain(a.id);
  expect(await recall(root, store, null, 'kubernetes', T)).toEqual([]);
  expect((await recall(root, store, null, '', T)).map((m) => m.kind)).toEqual([
    'convention',
    'gotcha',
    'todo',
  ]);
  expect((await recall(root, store, null, '', T, { kind: 'todo' })).map((m) => m.text)).toEqual([
    'Move notify to a queue.',
  ]);
  expect(await recall(root, store, null, 'sku', T, { kind: 'todo' })).toEqual([]);
  store.close();
});

test('recall with an embedding model also matches by meaning, and embeds memories lazily', async () => {
  const { root, store } = await indexed('py-pkg');
  const provider = fakeProvider();
  const kept = remember(root, store, {
    text: 'charge customers through the payment gateway',
    kind: 'decision',
  }).memory;
  remember(root, store, { text: 'documentation lives in the wiki', kind: 'convention' });

  provider.calls.length = 0;
  const found = await recall(root, store, provider, 'gateway charge customers payment', {
    ...T,
    memoryMinSimilarity: 0.5,
  });
  expect(found[0]?.id).toBe(kept.id);
  // Two memories embedded once, plus the query.
  expect(provider.calls.map((batch) => batch.length)).toEqual([2, 1]);
  provider.calls.length = 0;
  await recall(root, store, provider, 'wiki documentation', T);
  expect(provider.calls.map((batch) => batch.length)).toEqual([0, 1]);
  // A high similarity bar removes weak vector-only matches.
  const strict = await recall(root, store, provider, 'zzz qqq', { ...T, memoryMinSimilarity: 0.9 });
  expect(strict).toEqual([]);
  store.close();
});

test('forget deletes a memory from the database and the mirror', async () => {
  const { root, store } = await indexed('go-mod');
  const { memory } = remember(root, store, {
    text: 'Keys are lower case.',
    kind: 'convention',
    symbols: ['normalize'],
  });
  expect(forget(root, store, memory.id)).toBe(true);
  expect(forget(root, store, memory.id)).toBe(false);
  expect(store.listMemories()).toEqual([]);
  expect(readMirror(root).memories).toEqual([]);
  expect(await recall(root, store, null, 'keys lower', T)).toEqual([]);
  store.close();
});

test('deleting index.db and re-indexing restores memories from memory.json', async () => {
  const { root, store } = await indexed('ts-app');
  const { memory } = remember(root, store, {
    text: 'Tokens are sub.exp strings.',
    kind: 'gotcha',
    symbols: ['parseToken'],
    tags: ['auth'],
  });
  store.close();
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(join(root, `index.db${suffix}`), { force: true });
  expect(existsSync(mirror(root))).toBe(true);

  const fresh = new Store(join(root, 'index.db'));
  expect(fresh.listMemories()).toEqual([]);
  await indexRepo(root, fresh, TEST_CONFIG);
  const restored = fresh.listMemories();
  expect(restored).toEqual([{ ...memory, stale: false }]);
  expect((await recall(root, fresh, null, 'token format', T))[0]?.id).toBe(memory.id);
  expect(
    linkedMemories(fresh, [{ path: 'src/auth.ts', symbol: 'parseToken' }]).map((m) => m.id),
  ).toEqual([memory.id]);
  fresh.close();
});

test('editing a linked function marks its memory stale, and reverting clears it', async () => {
  const { root, store } = await indexed('ts-app');
  const hashFile = join(root, 'src/hash.ts');
  const original = readFileSync(hashFile, 'utf8');
  const onSymbol = remember(root, store, {
    text: 'hash uses a 31 multiplier.',
    kind: 'gotcha',
    symbols: ['hash'],
  }).memory;
  const onFile = remember(root, store, {
    text: 'db.ts is the only place that touches USERS.',
    kind: 'convention',
    paths: ['src/db.ts'],
  }).memory;
  const stale = (): Record<string, boolean> =>
    Object.fromEntries(store.listMemories().map((m) => [m.id, m.stale]));

  // An edit elsewhere in the same file does not touch the linked function.
  writeFileSync(hashFile, original.replace("'fixture-salt'", "'another-salt'"));
  await indexRepo(root, store, TEST_CONFIG);
  expect(stale()).toEqual({ [onSymbol.id]: false, [onFile.id]: false });

  writeFileSync(hashFile, original.replace('total * 31', 'total * 33'));
  await indexRepo(root, store, TEST_CONFIG);
  expect(stale()).toEqual({ [onSymbol.id]: true, [onFile.id]: false });
  expect(formatMemory(store.listMemories()[0] as never)).toContain(
    `${onSymbol.id} STALE: linked code has changed since this was written`,
  );

  writeFileSync(hashFile, original);
  await indexRepo(root, store, TEST_CONFIG);
  expect(stale()).toEqual({ [onSymbol.id]: false, [onFile.id]: false });

  // A file-level link goes stale on any change to the file; a deleted symbol is stale too.
  writeFileSync(
    join(root, 'src/db.ts'),
    `${readFileSync(join(root, 'src/db.ts'), 'utf8')}\n// note\n`,
  );
  rmSync(hashFile);
  await indexRepo(root, store, TEST_CONFIG);
  expect(stale()).toEqual({ [onSymbol.id]: true, [onFile.id]: true });
  expect(refreshStaleness(store)).toBe(2);
  store.close();
});

test('a memory.json changed outside codemem is picked up, and a broken one is refused', async () => {
  const { root, store } = await indexed('py-pkg');
  const mine = remember(root, store, {
    text: 'Orders are validated before charging.',
    kind: 'convention',
  }).memory;

  // A teammate's memory arrives through git.
  const file = JSON.parse(readFileSync(mirror(root), 'utf8')) as { memories: unknown[] };
  file.memories.push({
    id: 'm_teammate',
    kind: 'decision',
    text: 'Use receipts as idempotency keys.',
    tags: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    links: [{ path: 'shop/payments.py', symbol: 'charge', contentHash: 'outdated' }],
  });
  writeFileSync(mirror(root), JSON.stringify(file));
  const all = await recall(root, store, null, '', T);
  expect(all.map((m) => m.id)).toEqual(['m_teammate', mine.id]);
  // Its link hash does not match this checkout, so it is flagged.
  expect(all[0]?.stale).toBe(true);

  // Removing an entry from the file removes the memory.
  writeFileSync(mirror(root), JSON.stringify({ version: 1, memories: file.memories.slice(1) }));
  syncMemories(root, store);
  expect(store.listMemories().map((m) => m.id)).toEqual(['m_teammate']);

  writeFileSync(mirror(root), '{ "version": 1, "memories": [ <<<<<<< HEAD');
  expect(() => syncMemories(root, store)).toThrow(/memory\.json is not valid/);
  writeFileSync(
    mirror(root),
    JSON.stringify({ version: 1, memories: [{ id: 'x', kind: 'rumor', text: 't' }] }),
  );
  expect(() => syncMemories(root, store)).toThrow(MemoryError);
  // The database is untouched by the bad file.
  expect(store.listMemories().map((m) => m.id)).toEqual(['m_teammate']);
  store.close();
});

test('one shared word is not a match: a memory needs half of the query terms or enough similarity', async () => {
  const { root, store } = await indexed('py-pkg');
  const policy = remember(root, store, {
    text: 'Password rules live in the security handbook.',
    kind: 'decision',
  }).memory;
  // One of four terms: below the minimum.
  expect(await recall(root, store, null, 'reset the user password email', T)).toEqual([]);
  // Two of three terms.
  expect((await recall(root, store, null, 'password security review', T)).map((m) => m.id)).toEqual(
    [policy.id],
  );
  // The minimum is configurable: at zero, any shared word matches again.
  const loose = { ...T, memoryMinKeywordMatch: 0 };
  expect(
    (await recall(root, store, null, 'reset the user password email', loose)).map((m) => m.id),
  ).toEqual([policy.id]);
  // With a model, enough similarity is the other way in.
  const provider = fakeProvider();
  const similar = await recall(root, store, provider, 'handbook of security rules', {
    ...T,
    memoryMinKeywordMatch: 1,
  });
  expect(similar.map((m) => m.id)).toEqual([policy.id]);
  expect(
    await recall(root, store, provider, 'deploy pipeline', { ...T, memoryMinSimilarity: 0.5 }),
  ).toEqual([]);
  store.close();
});

test('a memory is attached automatically only through a whole-file link or a symbol in the results', async () => {
  const { root, store } = await indexed('ts-app');
  const onFile = remember(root, store, {
    text: 'auth.ts must not import from service.ts.',
    kind: 'convention',
    paths: ['src/auth.ts'],
  }).memory;
  const onSymbol = remember(root, store, {
    text: 'parseToken accepts sub.exp only.',
    kind: 'gotcha',
    symbols: ['parseToken'],
  }).memory;
  const ids = (results: { path: string; symbol: string | null }[]): string[] =>
    linkedMemories(store, results).map((m) => m.id);

  // Another symbol of the same file: the file-level memory comes along, the symbol one does not.
  expect(ids([{ path: 'src/auth.ts', symbol: 'authenticateUser' }])).toEqual([onFile.id]);
  expect(ids([{ path: 'src/auth.ts', symbol: null }])).toEqual([onFile.id]);
  expect(ids([{ path: 'src/auth.ts', symbol: 'parseToken' }])).toEqual([onFile.id, onSymbol.id]);
  // The same symbol name in another file is a different symbol.
  expect(ids([{ path: 'src/db.ts', symbol: 'parseToken' }])).toEqual([]);
  store.close();
});

test('memory.json is sorted by id with one memory per line', async () => {
  const { root, store } = await indexed('go-mod');
  for (const text of ['third note', 'first note', 'second note'])
    remember(root, store, { text, kind: 'todo' });
  const lines = readFileSync(mirror(root), 'utf8').split('\n');
  expect(lines.slice(0, 3)).toEqual(['{', '  "version": 1,', '  "memories": [']);
  expect(lines.slice(-3)).toEqual(['  ]', '}', '']);
  const entries = lines.slice(3, -3);
  expect(entries).toHaveLength(3);
  const ids = entries.map((line) => (JSON.parse(line.replace(/,$/, '')) as { id: string }).id);
  expect(ids).toEqual([...ids].sort());
  // Deleting the last one leaves valid JSON, and an empty list is valid too.
  forget(root, store, ids[2] as string);
  expect(readMirror(root).memories.map((m) => m.id)).toEqual(ids.slice(0, 2));
  forget(root, store, ids[0] as string);
  forget(root, store, ids[1] as string);
  expect(readMirror(root).memories).toEqual([]);
  // The file round-trips: a fresh database loads exactly what was written.
  const kept = remember(root, store, {
    text: 'kept',
    kind: 'decision',
    symbols: ['normalize'],
  }).memory;
  store.setMeta('memory_json_hash', '');
  syncMemories(root, store);
  expect(store.listMemories()).toEqual([kept]);
  store.close();
});

test('get_context puts linked and matching memories first, and marks stale ones', async () => {
  const { root, store } = await indexed('ts-app');
  const c = await client(root, store);
  const linked = remember(root, store, {
    text: 'Never log passwords in authenticateUser.',
    kind: 'convention',
    symbols: ['authenticateUser'],
  }).memory;
  const matching = remember(root, store, {
    text: 'Password check failures are counted per user.',
    kind: 'decision',
  }).memory;
  const oneWord = remember(root, store, {
    text: 'Password rules live in the security handbook.',
    kind: 'decision',
  }).memory;
  const unrelated = remember(root, store, {
    text: 'Deploys happen on Tuesdays.',
    kind: 'todo',
  }).memory;

  const context = (await call(c, 'get_context', { task: 'authenticateUser password check' })).text;
  const lines = context.split('\n');
  expect(lines[0]).toBe(
    '=== Project memory (decisions and conventions recorded for this repo) ===',
  );
  expect(lines[1]).toBe(`[convention] ${linked.id}`);
  expect(lines[2]).toBe('  Never log passwords in authenticateUser.');
  expect(context).toContain(`[decision] ${matching.id}`);
  expect(context).not.toContain(unrelated.id);
  // Sharing one word with the task is not enough.
  expect(context).not.toContain(oneWord.id);
  expect(context.indexOf('--- src/auth.ts')).toBeGreaterThan(context.indexOf(matching.id));

  // A memory linked to a returned file is attached even when its words do not match.
  const byFile = (await call(c, 'get_context', { task: 'verify timing safe comparison' })).text;
  expect(byFile).toContain(linked.id);
  // search_code does not add memories.
  expect((await call(c, 'search_code', { query: 'authenticateUser' })).text).not.toContain(
    'Project memory',
  );

  const authFile = join(root, 'src/auth.ts');
  writeFileSync(
    authFile,
    readFileSync(authFile, 'utf8').replace('if (!user) return false;', 'if (!user) return true;'),
  );
  await indexRepo(root, store, TEST_CONFIG);
  const after = (await call(c, 'get_context', { task: 'authenticateUser password check' })).text;
  expect(after).toContain(
    `[convention] ${linked.id} STALE: linked code has changed since this was written`,
  );

  // Memory takes at most a quarter of the budget, and the whole answer stays within it.
  const medium = (
    await call(c, 'get_context', { task: 'authenticateUser password check', budget_tokens: 400 })
  ).text;
  expect(countTokens(medium)).toBeLessThanOrEqual(400);
  expect(medium).toContain(linked.id);
  const block = medium.slice(0, medium.indexOf('\n\n--- '));
  expect(countTokens(block)).toBeLessThanOrEqual(100);
  // With too little room for even one memory, the answer is code only.
  const small = (
    await call(c, 'get_context', { task: 'authenticateUser password check', budget_tokens: 120 })
  ).text;
  expect(countTokens(small)).toBeLessThanOrEqual(120);
  expect(small).not.toContain('Project memory');
  store.close();
});

test('pack keeps a preamble inside the budget and drops it when it cannot fit', () => {
  const preamble = '=== Project memory ===\n[decision] m_1\n  Short note.';
  const withRoom = pack([], 200, preamble);
  expect(withRoom.text.startsWith(preamble)).toBe(true);
  expect(countTokens(withRoom.text)).toBeLessThanOrEqual(200);
  expect(withRoom.tokens).toBe(countTokens(withRoom.text));
  const tooSmall = pack([], 30, preamble);
  expect(tooSmall.text).not.toContain('Project memory');
  expect(countTokens(tooSmall.text)).toBeLessThanOrEqual(30);
});

test('the server offers nine tools; remember, recall, and forget work through the protocol', async () => {
  const { root, store } = await indexed('go-mod');
  const c = await client(root, store);
  const { tools } = await c.listTools();
  expect(tools.map((t) => t.name)).toEqual([
    'get_context',
    'search_code',
    'get_symbol',
    'get_file_outline',
    'find_references',
    'remember',
    'recall',
    'forget',
    'index_status',
  ]);
  const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
  expect(hints).toMatchObject({ remember: false, forget: false, recall: true, get_context: true });
  for (const tool of tools) expect(countTokens(tool.description ?? ''), tool.name).toBeLessThan(80);

  const stored = await call(c, 'remember', {
    text: 'Keys are normalized to lower case before lookup.',
    kind: 'convention',
    symbols: ['normalize', 'nope'],
  });
  const id = /m_[0-9a-f]{8}/.exec(stored.text)?.[0] ?? '';
  expect(stored.text).toBe(
    `Stored memory ${id} (convention), linked to store.go normalize.\nNot linked: nope (no such symbol in the index).`,
  );
  const recalled = await call(c, 'recall', { query: 'lower case keys' });
  expect(recalled.text).toContain(
    `[convention] ${id}\n  Keys are normalized to lower case before lookup.\n  (linked: store.go normalize)`,
  );
  expect((await call(c, 'recall', { query: 'lower case keys', kind: 'todo' })).text).toBe(
    'No memories match.',
  );
  expect((await call(c, 'remember', { text: 'x', kind: 'rumor' })).isError).toBe(true);

  expect((await call(c, 'forget', { id })).text).toBe(`Forgot memory ${id}.`);
  expect(await call(c, 'forget', { id })).toEqual({
    text: `Error: No memory with id ${id}. Use recall to list ids.`,
    isError: true,
  });
  store.close();
});

test('codemem memory add, list, and rm work without a prior index', async () => {
  const { root, store } = await indexed('py-pkg');
  store.close();
  mkdirSync(join(root, '.codemem'), { recursive: true });
  writeFileSync(join(root, '.codemem/config.json'), '{ "embedding": { "provider": "none" } }');
  const added = await runMemory(root, 'add', {
    text: 'Ship on Fridays only after review.',
    kind: 'convention',
    tags: ['release'],
  });
  const id = /m_[0-9a-f]{8}/.exec(added)?.[0] ?? '';
  expect(added).toBe(`Stored memory ${id} (convention).`);
  const listed = await runMemory(root, 'list', { query: '' });
  expect(listed).toContain(
    `[convention] ${id}\n  Ship on Fridays only after review.\n  (tags: release)`,
  );
  expect(await runMemory(root, 'list', { query: 'fridays', kind: 'todo' })).toBe(
    'No memories match.',
  );
  expect(await runMemory(root, 'rm', { id })).toBe(`Forgot memory ${id}.`);
  await expect(runMemory(root, 'rm', { id })).rejects.toThrow(/No memory with id/);
});
