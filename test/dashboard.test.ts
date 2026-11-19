import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { folderView } from '../src/dashboard/graph.js';
import {
  discoveryFile,
  findDashboard,
  startDashboard,
  type Dashboard,
} from '../src/dashboard/server.js';
import { indexStatus, type ToolContext } from '../src/mcp/tools.js';
import { indexed, TEST_CONFIG } from './helpers.js';

test('the folder view sums file edges onto the children of a folder', () => {
  const files = [
    { path: 'src/a/one.ts', language: 'typescript', symbols: 3 },
    { path: 'src/a/two.ts', language: 'typescript', symbols: 2 },
    { path: 'src/b.py', language: 'python', symbols: 4 },
    { path: 'README.md', language: null, symbols: 0 },
  ];
  const edges = [
    { src: 'src/a/one.ts', dst: 'src/b.py', weight: 2 },
    { src: 'src/a/two.ts', dst: 'src/b.py', weight: 1 },
    { src: 'src/a/one.ts', dst: 'src/a/two.ts', weight: 5 },
    { src: 'README.md', dst: 'src/b.py', weight: 1 },
  ];

  const root = folderView(files, edges, '');
  expect(root.nodes.map((n) => [n.id, n.type, n.files, n.symbols])).toEqual([
    ['src', 'folder', 3, 9],
    ['README.md', 'file', 1, 0],
  ]);
  expect(root.edges).toEqual([{ source: 'README.md', target: 'src', weight: 1 }]);

  const src = folderView(files, edges, 'src/');
  expect(src.dir).toBe('src');
  expect(src.nodes.map((n) => [n.label, n.language])).toEqual([
    ['a', 'typescript'],
    ['b.py', 'python'],
  ]);
  // Both files in src/a call into b.py; the edge inside src/a is not shown at this level.
  expect(src.edges).toEqual([{ source: 'src/a', target: 'src/b.py', weight: 3 }]);
});

describe('the dashboard server', () => {
  let ctx: ToolContext;
  let dashboard: Dashboard;
  let token: string;
  let origin: string;

  beforeAll(async () => {
    const { root, store } = await indexed('ts-app');
    ctx = { root, config: TEST_CONFIG, store, provider: null };
    dashboard = await startDashboard(ctx);
    const url = new URL(dashboard.url);
    token = url.searchParams.get('token') ?? '';
    origin = url.origin;
  });
  afterAll(async () => {
    await dashboard.close();
    ctx.store.close();
  });

  const call = async (
    path: string,
    init: RequestInit = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON answers, checked field by field
  ): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${origin}${path}`, {
      ...init,
      headers: {
        'x-remimem-token': token,
        ...(init.body !== undefined ? { 'content-type': 'application/json', origin } : {}),
        ...init.headers,
      },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const send = (method: string, path: string, body: unknown) =>
    call(path, { method, body: JSON.stringify(body) });

  test('listens on 127.0.0.1 only and refuses requests without the token or for another host', async () => {
    expect(dashboard.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]{32}$/);
    expect((await call('/api/overview', { headers: { 'x-remimem-token': 'wrong' } })).status).toBe(
      401,
    );
    const status = await new Promise<number>((resolve, reject) => {
      // A DNS-rebinding page reaches 127.0.0.1 under its own host name.
      request(
        `${origin}/api/overview`,
        { headers: { host: 'evil.example', 'x-remimem-token': token } },
        (res) => resolve(res.statusCode ?? 0),
      )
        .on('error', reject)
        .end();
    });
    expect(status).toBe(421);
  });

  test('refuses changes from another origin, and changes that are not JSON', async () => {
    const evil = await call('/api/memories', {
      method: 'POST',
      body: JSON.stringify({ text: 'x', kind: 'decision' }),
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.status).toBe(403);
    const form = await fetch(`${origin}/api/memories`, {
      method: 'POST',
      headers: { 'x-remimem-token': token, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'text=x',
    });
    expect(form.status).toBe(403);
    expect(ctx.store.listMemories()).toEqual([]);
  });

  test('serves the page without the token, and never sends CORS headers', async () => {
    const page = await fetch(`${origin}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>remimem dashboard</title>');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('writes a discovery file only the user can read, and index_status shows the URL', async () => {
    expect(findDashboard(ctx.root)?.url).toBe(dashboard.url);
    if (process.platform !== 'win32') {
      expect(readFileSync(discoveryFile(ctx.root)).length).toBeGreaterThan(0);
      const { statSync } = await import('node:fs');
      expect(statSync(discoveryFile(ctx.root)).mode & 0o077).toBe(0);
    }
    expect(await indexStatus({ ...ctx, dashboardUrl: dashboard.url })).toContain(
      `Dashboard: ${dashboard.url}`,
    );
  });

  test('reports the index and the graph', async () => {
    const overview = await call('/api/overview');
    expect(overview.body.counts.files).toBeGreaterThan(0);
    expect(overview.body.languages.map((l: { language: string }) => l.language)).toContain(
      'typescript',
    );

    const graph = await call('/api/graph?dir=src');
    expect(graph.body.nodes.map((n: { id: string }) => n.id)).toContain('src/service.ts');
    expect(graph.body.edges.length).toBeGreaterThan(0);

    const file = await call('/api/file?path=src/service.ts');
    const withNeighbors = file.body.symbols.find(
      (s: { neighbors: unknown[] }) => s.neighbors.length > 0,
    );
    expect(withNeighbors).toBeDefined();
    const code = await call(`/api/symbol?id=${withNeighbors.id}`);
    expect(code.body.code).toContain(withNeighbors.name);
    expect((await call('/api/file?path=nope.ts')).status).toBe(404);
  });

  test('search answers like the tools but is not logged', async () => {
    const answer = await send('POST', '/api/search', { query: 'hash password', budget: 1500 });
    expect(answer.status).toBe(200);
    expect(answer.body.results.length).toBeGreaterThan(0);
    expect(answer.body.tokens).toBeLessThanOrEqual(1500);
    expect(answer.body.text).toContain('src/');
    expect(ctx.store.queryLogSummary()).toEqual([]);
  });

  test('adds, edits, and forgets memories, mirrored to memory.json', async () => {
    const added = await send('POST', '/api/memories', {
      text: 'Passwords are hashed with scrypt.',
      kind: 'convention',
      paths: ['src/hash.ts'],
      tags: ['security'],
    });
    expect(added.status).toBe(200);
    const id = added.body.memory.id as string;

    const edited = await send('PUT', `/api/memories/${id}`, {
      text: 'Passwords are hashed with argon2.',
      kind: 'decision',
    });
    expect(edited.body.memory).toMatchObject({
      id,
      kind: 'decision',
      createdAt: added.body.memory.createdAt,
    });
    const mirror = readFileSync(join(ctx.root, '.remimem', 'memory.json'), 'utf8');
    expect(mirror).toContain('argon2');
    expect(mirror).not.toContain('scrypt');

    expect(
      (await send('PUT', '/api/memories/m_missing', { text: 'x', kind: 'decision' })).status,
    ).toBe(400);
    expect((await send('POST', '/api/memories', { text: 'x', kind: 'rumor' })).status).toBe(400);
    expect((await send('DELETE', `/api/memories/${id}`, {})).body).toEqual({ deleted: id });
    expect((await send('DELETE', `/api/memories/${id}`, {})).status).toBe(404);
  });

  test('validates config edits before writing them, then uses them at once', async () => {
    const bad = await send('PUT', '/api/config', { config: { retrieval: { defaultK: -1 } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/defaultK/);
    expect(existsSync(join(ctx.root, '.remimem', 'config.json'))).toBe(false);

    const config = {
      embedding: { provider: 'none' },
      retrieval: { defaultK: 7 },
      exclude: ['index.db*'],
    };
    const good = await send('PUT', '/api/config', { config });
    expect(good.body.needsFullIndex).toBe(false);
    expect(ctx.config.retrieval.defaultK).toBe(7);
    expect(JSON.parse(readFileSync(join(ctx.root, '.remimem', 'config.json'), 'utf8'))).toEqual(
      config,
    );
    expect((await call('/api/config')).body.raw).toEqual(config);
  });

  test('re-indexes on request', async () => {
    const run = await send('POST', '/api/index', { full: true });
    expect(run.status).toBe(200);
    expect(run.body.stats.indexed).toBeGreaterThan(0);
  });

  test('removes its discovery file when it closes', async () => {
    const other = await startDashboard(ctx);
    expect(findDashboard(ctx.root)?.url).toBe(other.url);
    await other.close();
    expect(existsSync(discoveryFile(ctx.root))).toBe(false);
  });
});
