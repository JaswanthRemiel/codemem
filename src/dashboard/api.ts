// The dashboard's JSON API. Every handler works on the same ToolContext as the MCP tools, so
// the page shows exactly what the agent sees, and changes take effect for the agent at once.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { runDoctor } from '../cli/commands.js';
import { CONFIG_DIR, parseConfig } from '../config/index.js';
import { createProvider } from '../embedder/index.js';
import { RemimemError } from '../errors.js';
import { indexRepo, pendingChanges } from '../indexer/index.js';
import { forget, MEMORY_KINDS, MemoryError, remember, type MemoryKind } from '../memory/index.js';
import { pack } from '../packer/index.js';
import { search } from '../retriever/index.js';
import { refreshIndex, type ToolContext } from '../mcp/tools.js';
import { folderView } from './graph.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

/** A request the API answers: method, path without the query, query parameters, JSON body. */
export interface ApiRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export class NotFoundError extends RemimemError {}

const object = (body: unknown): Record<string, unknown> =>
  typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    : [];

function memoryInput(body: unknown): {
  text: string;
  kind: MemoryKind;
  paths: string[];
  symbols: string[];
  tags: string[];
} {
  const b = object(body);
  const kind = typeof b['kind'] === 'string' ? b['kind'] : 'decision';
  if (!(MEMORY_KINDS as readonly string[]).includes(kind)) {
    throw new MemoryError(`Unknown kind "${kind}". Use one of: ${MEMORY_KINDS.join(', ')}.`);
  }
  return {
    text: typeof b['text'] === 'string' ? b['text'] : '',
    kind: kind as MemoryKind,
    paths: strings(b['paths']),
    symbols: strings(b['symbols']),
    tags: strings(b['tags']),
  };
}

/** Re-indexes now, after any refresh already running, and lets tool calls wait for it. */
async function reindex(ctx: ToolContext, full: boolean): Promise<unknown> {
  if (ctx.refreshing) await ctx.refreshing;
  const run = indexRepo(ctx.root, ctx.store, ctx.config, { provider: ctx.provider, full });
  ctx.refreshing = run.catch(() => undefined).finally(() => (ctx.refreshing = undefined));
  return await run;
}

function configPath(root: string): string {
  return join(root, CONFIG_DIR, 'config.json');
}

function readRawConfig(root: string): unknown {
  try {
    return JSON.parse(readFileSync(configPath(root), 'utf8')) as unknown;
  } catch {
    return {};
  }
}

export async function handleApi(ctx: ToolContext, req: ApiRequest): Promise<unknown> {
  const { store } = ctx;
  const route = `${req.method} ${req.path}`;
  const memoryId = /^\/api\/memories\/([\w-]+)$/.exec(req.path)?.[1];

  switch (route) {
    case 'GET /api/overview': {
      const counts = store.counts();
      const files = store.fileSummaries();
      const languages = new Map<string, number>();
      for (const f of files)
        languages.set(f.language ?? 'text', (languages.get(f.language ?? 'text') ?? 0) + 1);
      const memories = store.listMemories();
      return {
        root: ctx.root,
        version: pkg.version,
        counts: { ...counts, edges: store.edgeCount(), vectors: store.vectorCount() },
        embeddingModel: store.embeddingModel() ?? null,
        lastIndexedAt: store.getMeta('last_indexed_at') ?? null,
        lastIndexedCommit: store.getMeta('last_indexed_commit') ?? null,
        languages: [...languages]
          .map(([language, count]) => ({ language, files: count }))
          .sort((a, b) => b.files - a.files),
        memories: { total: memories.length, stale: memories.filter((m) => m.stale).length },
        pending: counts.files > 0 ? await pendingChanges(ctx.root, store, ctx.config) : null,
        indexing: ctx.refreshing !== undefined,
      };
    }

    case 'GET /api/graph':
      return folderView(store.fileSummaries(), store.fileEdges(), req.query.get('dir') ?? '');

    case 'GET /api/file': {
      const path = req.query.get('path') ?? '';
      const language = store.fileLanguage(path);
      if (language === undefined) throw new NotFoundError(`No file "${path}" in the index.`);
      const symbols = store.symbolsInFile(path);
      const neighbors = store.neighbors(symbols.map((s) => s.id));
      return {
        path,
        language,
        symbols: symbols.map((s) => ({
          ...s,
          // The parent and children are shown by nesting, so only cross-symbol edges are listed.
          neighbors: neighbors
            .filter((n) => n.of === s.id && n.relation !== 'inside' && n.relation !== 'contains')
            .map((n) => ({
              id: n.id,
              path: n.path,
              name: n.qualifiedName,
              kind: n.kind,
              line: n.startLine,
              relation: n.relation,
              confidence: n.confidence,
            })),
        })),
        memories: store.listMemories().filter((m) => m.links.some((l) => l.path === path)),
      };
    }

    case 'GET /api/symbol': {
      const chunks = store.chunksOfSymbol(Number(req.query.get('id')));
      if (chunks.length === 0) throw new NotFoundError('No code for that symbol in the index.');
      const first = chunks[0] as (typeof chunks)[number];
      return {
        path: first.path,
        startLine: first.startLine,
        code: chunks.map((c) => c.content).join('\n'),
      };
    }

    case 'POST /api/search': {
      const b = object(req.body);
      const text = typeof b['query'] === 'string' ? b['query'].trim() : '';
      if (!text) throw new RemimemError('Type something to search for.');
      const retrieval = ctx.config.retrieval;
      const budget = Number.isFinite(b['budget'])
        ? Number(b['budget'])
        : retrieval.defaultBudgetTokens;
      const k = Number.isFinite(b['k']) ? Number(b['k']) : retrieval.defaultK;
      await refreshIndex(ctx);
      const started = performance.now();
      // Not logged: trying queries here should not count toward the savings in `remimem stats`.
      const results = await search(store, text, retrieval, ctx.provider, k);
      const packed = pack(results, budget, '', retrieval.neighborBudgetShare);
      const shown = new Set(packed.included.map((item) => item.chunk.id));
      return {
        ms: Math.round(performance.now() - started),
        tokens: packed.tokens,
        budget,
        text: packed.text,
        results: results.map((r) => ({
          path: r.chunk.path,
          startLine: r.chunk.startLine,
          endLine: r.chunk.endLine,
          symbol: r.chunk.symbol,
          kind: r.chunk.kind,
          score: r.score,
          reasons: r.reasons,
          ranks: r.ranks,
          detail: r.detail,
          tokens: r.chunk.tokenCount,
          included: shown.has(r.chunk.id),
        })),
      };
    }

    case 'GET /api/memories':
      return { kinds: MEMORY_KINDS, memories: store.listMemories() };

    case 'POST /api/memories':
      return remember(ctx.root, store, memoryInput(req.body));

    case 'GET /api/stats':
      return { byTool: store.queryLogSummary(), daily: store.queryLogDaily() };

    case 'GET /api/doctor':
      return await runDoctor(ctx.root);

    case 'POST /api/index':
      return { stats: await reindex(ctx, object(req.body)['full'] === true) };

    case 'GET /api/config':
      return { raw: readRawConfig(ctx.root), effective: ctx.config };

    case 'PUT /api/config': {
      const raw = object(req.body)['config'];
      // Throws a ConfigError with the schema's message when the edit is not valid.
      const config = parseConfig(raw);
      mkdirSync(join(ctx.root, CONFIG_DIR), { recursive: true });
      writeFileSync(configPath(ctx.root), `${JSON.stringify(raw, null, 2)}\n`);
      const embeddingChanged =
        JSON.stringify(config.embedding) !== JSON.stringify(ctx.config.embedding);
      ctx.config = config;
      if (embeddingChanged) ctx.provider = createProvider(config.embedding);
      return { effective: config, needsFullIndex: embeddingChanged };
    }
  }

  if (memoryId !== undefined && req.method === 'PUT') {
    return remember(ctx.root, store, { ...memoryInput(req.body), id: memoryId });
  }
  if (memoryId !== undefined && req.method === 'DELETE') {
    if (!forget(ctx.root, store, memoryId))
      throw new NotFoundError(`No memory with id ${memoryId}.`);
    return { deleted: memoryId };
  }
  throw new NotFoundError(`No such API route: ${route}`);
}
