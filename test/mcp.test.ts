import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import { clientConfigs, runContext, runIndex, runInit } from '../src/cli/commands.js';
import { parseConfig } from '../src/config/index.js';
import { buildOverview } from '../src/indexer/overview.js';
import { indexRepo } from '../src/indexer/index.js';
import { createServer, OVERVIEW_URI } from '../src/mcp/server.js';
import { Store } from '../src/store/index.js';
import { countTokens } from '../src/tokens.js';
import { copyFixture, indexed, TEST_CONFIG } from './helpers.js';

const TOOL_NAMES = [
  'get_context',
  'search_code',
  'get_symbol',
  'get_file_outline',
  'find_references',
  'index_status',
];

/** A client connected in memory to a server over an indexed fixture. */
async function connect(fixture: string): Promise<{ client: Client; root: string; store: Store }> {
  const { root, store } = await indexed(fixture);
  const server = createServer({ root, config: TEST_CONFIG, store, provider: null });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, root, store };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { text: content[0]?.text ?? '', isError: result.isError === true };
}

function useKeywordOnly(root: string): void {
  mkdirSync(join(root, '.codemem'), { recursive: true });
  writeFileSync(join(root, '.codemem/config.json'), '{ "embedding": { "provider": "none" } }');
}

test('the server lists every tool with a valid schema and short description', async () => {
  const { client } = await connect('ts-app');
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES);
  for (const tool of tools) {
    expect(tool.inputSchema.type, tool.name).toBe('object');
    expect(tool.description?.length, tool.name).toBeGreaterThan(40);
    // Descriptions are loaded into every agent session, so they stay small.
    expect(countTokens(tool.description ?? ''), tool.name).toBeLessThan(80);
    expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
  }
  const getContext = tools.find((t) => t.name === 'get_context');
  expect(getContext?.inputSchema.required).toEqual(['task']);
  expect(Object.keys(getContext?.inputSchema.properties ?? {})).toEqual([
    'task',
    'budget_tokens',
    'paths',
  ]);
  expect(client.getInstructions()).toMatch(/get_context/);
});

test('get_context and search_code return packed text with a footer, within the budget', async () => {
  const { client } = await connect('ts-app');
  const context = await call(client, 'get_context', { task: 'authenticateUser password check' });
  expect(context.isError).toBe(false);
  expect(context.text.split('\n')[0]).toMatch(
    /^--- src\/auth\.ts:10-23 function authenticateUser \[/,
  );
  expect(context.text).toContain('(signature only)');
  expect(context.text.split('\n').at(-1)).toMatch(/^~[\d,]+ tokens \| \d+ results/);

  const small = await call(client, 'get_context', { task: 'user login', budget_tokens: 150 });
  expect(countTokens(small.text)).toBeLessThanOrEqual(150);

  const search = await call(client, 'search_code', { query: 'findUser', k: 1 });
  expect(search.text).toContain('--- src/db.ts:18-21 function findUser [exact-symbol');
});

test('search_code filters by language and by path globs', async () => {
  const { client } = await connect('ts-app');
  const headers = (text: string): string[] => text.split('\n').filter((l) => l.startsWith('--- '));
  const all = await call(client, 'search_code', { query: 'login', k: 10 });
  expect(headers(all.text).some((h) => h.includes('src/legacy.js'))).toBe(true);

  const js = await call(client, 'search_code', { query: 'login', k: 10, language: 'javascript' });
  expect(headers(js.text).length).toBeGreaterThan(0);
  for (const header of headers(js.text)) expect(header).toContain('src/legacy.js');

  const scoped = await call(client, 'search_code', { query: 'user', k: 5, paths: ['db/**'] });
  expect(headers(scoped.text).length).toBeGreaterThan(0);
  for (const header of headers(scoped.text)) expect(header).toContain('db/schema.sql');
});

test('get_symbol, find_references, and get_file_outline answer from the graph', async () => {
  const { client } = await connect('ts-app');
  const symbol = await call(client, 'get_symbol', { name: 'authenticateUser' });
  expect(symbol.text).toContain('Called by:\n  UserService.login  src/service.ts:33-38  [import]');
  expect(symbol.text.split('\n').at(-1)).toMatch(/^~\d+ tokens$/);
  const signature = await call(client, 'get_symbol', {
    name: 'hash',
    include: 'signature',
    depth: 0,
  });
  expect(signature.text).toContain('export default function hash(input: string): string');
  expect(signature.text).not.toContain('charCodeAt');

  const refs = await call(client, 'find_references', { name: 'findUser' });
  expect(refs.text).toMatch(/^4 references in 2 files to function findUser/);
  expect(refs.text).toContain('src/auth.ts:20  call in authenticateUser [import]');

  const outline = await call(client, 'get_file_outline', { path: './src/auth.ts' });
  expect(outline.text.split('\n').slice(0, 6)).toEqual([
    'src/auth.ts (typescript, 5 symbols)',
    '5-8 interface Claims',
    '  export interface Claims',
    '14-23 function authenticateUser',
    '  export async function authenticateUser(id: string, password: string): Promise<boolean>',
    '  16-18 function verify',
  ]);
  expect(outline.text).not.toContain('timingSafeEqual');
  expect((await call(client, 'get_file_outline', { path: 'db/schema.sql' })).text).toMatch(
    /has no symbols/,
  );
  expect((await call(client, 'get_file_outline', { path: '../../etc/passwd' })).text).toMatch(
    /^No file/,
  );
});

test('index_status reports counts, pending changes, and the embedding model', async () => {
  const { client, root } = await connect('go-mod');
  const before = (await call(client, 'index_status')).text.split('\n');
  expect(before[0]).toBe('Files: 3 | Symbols: 16 | Chunks: 15 | Edges: 25');
  expect(before[1]).toMatch(/^Last indexed: \d{4}-\d\d-\d\dT/);
  expect(before[2]).toBe('Pending changes: 0 changed, 0 new, 0 deleted');
  expect(before[3]).toBe('Embedding model: none (keyword search only)');

  writeFileSync(join(root, 'extra.go'), 'package kv\n\nfunc Extra() {}\n');
  writeFileSync(join(root, 'go.mod'), 'module example.com/kv\n\ngo 1.23\n');
  const after = (await call(client, 'index_status')).text;
  expect(after).toContain('Pending changes: 1 changed, 1 new, 0 deleted (run `codemem index`)');
});

test('the overview resource is a directory map with the most-referenced symbols', async () => {
  const { client } = await connect('ts-app');
  const { resources } = await client.listResources();
  expect(resources.map((r) => r.uri)).toEqual([OVERVIEW_URI]);
  const { contents } = await client.readResource({ uri: OVERVIEW_URI });
  expect((contents[0] as { text: string }).text).toBe(
    [
      '7 files, 32 symbols. Directories show their file count and most-referenced symbols.',
      'db/ (1 files)',
      'src/ (6 files): User, UserId, findUser, hash, UserService',
    ].join('\n'),
  );
});

test('the overview stays under 1,500 tokens on a wide and deep repo', async () => {
  const root = copyFixture('go-mod');
  for (let i = 0; i < 400; i++) {
    const dir = join(root, `pkg${i % 40}`, `feature_${i}`, 'internal', 'deep');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'handler.ts'),
      `export function handleFeature${i}(): number {\n  return helperFeature${i}();\n}\nexport function helperFeature${i}(): number {\n  return ${i};\n}\n`,
    );
  }
  const store = new Store(join(root, 'index.db'));
  await indexRepo(root, store, TEST_CONFIG);
  const overview = buildOverview(store);
  expect(countTokens(overview)).toBeLessThanOrEqual(1500);
  expect(overview).toContain('pkg0/ (10 files)');
  expect(store.getMeta('overview')).toBe(overview);
  store.close();
}, 60_000);

test('a failing tool call is an error result, and the server keeps answering', async () => {
  const root = copyFixture('go-mod');
  const store = new Store(join(root, 'index.db'));
  const server = createServer({ root, config: TEST_CONFIG, store, provider: null });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  const empty = await call(client, 'get_context', { task: 'anything' });
  expect(empty).toEqual({
    text: 'Error: The index is empty. Run `codemem index` (or `codemem init`) in the project first.',
    isError: true,
  });
  // Arguments that break the schema are rejected without reaching the handler.
  const invalid = await call(client, 'search_code', { query: 'x', k: 'many' });
  expect(invalid.isError).toBe(true);
  // A broken store makes handlers throw; the agent still gets a readable answer.
  store.close();
  const broken = await call(client, 'find_references', { name: 'New' });
  expect(broken.isError).toBe(true);
  expect(broken.text).toMatch(/^Error: /);
  expect((await client.listTools()).tools).toHaveLength(TOOL_NAMES.length);
});

test('serve writes nothing but protocol messages to stdout', async () => {
  const root = copyFixture('py-pkg');
  useKeywordOnly(root);
  await runIndex(root, {});
  // Debug logging is on, so there is log output: it must all land on stderr.
  const child = spawn(process.execPath, ['dist/cli/index.js', 'serve', '--root', root], {
    env: { ...process.env, CODEMEM_LOG_LEVEL: 'debug' },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
  child.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
  const requests = [
    {
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
    },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    {
      id: 3,
      method: 'tools/call',
      params: { name: 'get_context', arguments: { task: 'charge a card' } },
    },
    {
      id: 4,
      method: 'tools/call',
      params: { name: 'get_symbol', arguments: { name: 'no_such_symbol' } },
    },
    { id: 5, method: 'tools/call', params: { name: 'index_status', arguments: {} } },
    { id: 6, method: 'resources/read', params: { uri: OVERVIEW_URI } },
    { id: 7, method: 'no/such/method' },
  ];
  for (const request of requests)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...request })}\n`);
  child.stdin.end();
  const code = await new Promise((done) => child.on('close', done));

  expect(code).toBe(0);
  const lines = stdout.split('\n').filter(Boolean);
  expect(lines).toHaveLength(7);
  for (const line of lines) {
    const message = JSON.parse(line) as { jsonrpc: string; id: number };
    expect(message.jsonrpc).toBe('2.0');
    expect(typeof message.id).toBe('number');
  }
  const byId = new Map(
    lines
      .map((l) => JSON.parse(l) as { id: number; result?: { content: { text: string }[] } })
      .map((m) => [m.id, m]),
  );
  expect(byId.get(3)?.result?.content[0]?.text).toContain('def charge(amount, token):');
  expect(stderr).toMatch(/codemem debug: get_context answered in \d+ ms/);
}, 60_000);

test('init writes config and .gitignore once, indexes, and prints client configs', async () => {
  const root = copyFixture('py-pkg');
  writeFileSync(join(root, '.gitignore'), 'node_modules/');
  const first = await runInit(root, {});
  expect(first).toContain('Created .codemem/config.json');
  expect(first).toContain('Added .codemem/index.db* to .gitignore.');
  expect(first).toContain('Privacy: everything runs on this machine. No code leaves it');
  expect(first).toMatch(/Indexed 4 of 4 files/);
  expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
    'node_modules/\n.codemem/index.db*\n',
  );
  expect(readFileSync(join(root, '.codemem/config.json'), 'utf8')).toBe('{}\n');

  // A second run changes nothing and keeps an edited config.
  useKeywordOnly(root);
  const second = await runInit(root, {});
  expect(second).not.toContain('Created');
  expect(second).not.toContain('Added');
  expect(second).toContain('Embeddings are off.');
  expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
    'node_modules/\n.codemem/index.db*\n',
  );
}, 180_000);

test('client configs are valid JSON that starts this build of the server', () => {
  const text = clientConfigs();
  expect(text).toMatch(/claude mcp add codemem -- node .*index\.js serve/);
  const blocks = text.split('\n\n').flatMap((part) => {
    const start = part.indexOf('{');
    return start === -1 ? [] : [part.slice(start)];
  });
  expect(blocks.length).toBeGreaterThanOrEqual(3);
  const claude = JSON.parse(blocks[0] as string) as {
    mcpServers: { codemem: { command: string; args: string[] } };
  };
  expect(claude.mcpServers.codemem.command).toBe('node');
  expect(claude.mcpServers.codemem.args.at(-1)).toBe('serve');
  expect(text).toContain('"type": "stdio"');
});

test('codemem context prints what get_context returns', async () => {
  const root = copyFixture('go-mod');
  await expect(runContext(root, 'x', {})).rejects.toThrow(/codemem index/);
  useKeywordOnly(root);
  await runIndex(root, {});
  const out = await runContext(root, 'normalize a key', { budget: 300 });
  expect(out).toContain('func normalize(key Key) Key');
  expect(countTokens(out)).toBeLessThanOrEqual(300);
  expect(parseConfig({}).retrieval.contextK).toBe(20);
});
