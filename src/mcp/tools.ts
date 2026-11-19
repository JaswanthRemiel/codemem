import { matchesGlob } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import type { EmbeddingProvider } from '../embedder/index.js';
import { RemimemError } from '../errors.js';
import { describeSymbol, findReferences } from '../graph/describe.js';
import { indexRepo, pendingChanges } from '../indexer/index.js';
import { log } from '../log.js';
import {
  forget,
  formatMemory,
  linkedMemories,
  MEMORY_KINDS,
  recall,
  remember,
  type Memory,
} from '../memory/index.js';
import { pack } from '../packer/index.js';
import { LANGS, languageOf } from '../parser/index.js';
import { search } from '../retriever/index.js';
import type { Store } from '../store/index.js';
import { countTokens } from '../tokens.js';

/** What every tool needs: the repo, its settings, the index, and the embedding model. */
export interface ToolContext {
  root: string;
  config: Config;
  store: Store;
  provider: EmbeddingProvider | null;
  /** The refresh that is running now, shared by concurrent tool calls. */
  refreshing?: Promise<unknown> | undefined;
  /** True while a refresh has not finished within the time a tool call may wait for it. */
  refreshPending?: boolean;
  /** The local dashboard's address, when the server runs one. */
  dashboardUrl?: string | undefined;
}

/** What a tool returns: text for the agent, and the files its code came from. */
export interface ToolResult {
  text: string;
  /** Paths whose code is in `text`, for the baseline estimate in `remimem stats`. */
  files?: string[];
  /** Distinct paths of the search results, best first, before packing. */
  rankedFiles?: string[];
}

/** How long a tool call waits for the index to catch up with the files. */
export const REFRESH_WAIT_MS = 2000;
const REFRESH_NOTE = '(index refresh still running: results may not include your latest edits)';
/** Room kept in the budget for the note above. */
const REFRESH_NOTE_TOKENS = 20;

export class EmptyIndexError extends RemimemError {
  constructor(building = false) {
    super(
      building
        ? 'The index is still being built for the first time. Try again in a moment.'
        : 'The index is empty. Run `remimem index` (or `remimem init`) in the project first.',
    );
  }
}

const withTokens = (text: string): string =>
  `${text}\n\n~${countTokens(text).toLocaleString('en-US')} tokens`;

function requireIndex(ctx: ToolContext): void {
  if (ctx.store.counts().files === 0) throw new EmptyIndexError(ctx.refreshPending);
}

export interface QueryOptions {
  k: number;
  budget: number;
  /** `get_context` puts project memory first. */
  memories?: boolean;
  language?: string | undefined;
  paths?: string[] | undefined;
}

/** Search, filter by language and path globs, and pack into the budget. */
export async function query(
  ctx: ToolContext,
  text: string,
  options: QueryOptions,
): Promise<ToolResult> {
  requireIndex(ctx);
  const { language, paths } = options;
  const filtered = language !== undefined || (paths !== undefined && paths.length > 0);
  // Filters are applied after ranking, so look further down the list when they are set.
  const pool = filtered ? Math.min(options.k * 10, 200) : options.k;
  let results = await search(ctx.store, text, ctx.config.retrieval, ctx.provider, pool);
  if (filtered) {
    let kept = 0;
    results = results.filter((r) => {
      const ok =
        (language === undefined || languageOf(r.chunk.path) === language) &&
        (!paths?.length || paths.some((glob) => matchesGlob(r.chunk.path, glob)));
      // Neighbors (signature only) ride along; only full results count toward k.
      return ok && (r.detail === 'signature' || ++kept <= options.k);
    });
  }
  const budget = options.budget - (ctx.refreshPending ? REFRESH_NOTE_TOKENS : 0);
  const preamble = options.memories ? await memoryBlock(ctx, text, results, budget) : '';
  const packed = pack(results, budget, preamble, ctx.config.retrieval.neighborBudgetShare);
  // Only results shown in full count toward the baseline: an agent would have had to read
  // those files, while the signature-only neighbors are an extra it would not have loaded.
  const files = packed.included
    .filter((item) => item.detail === 'full')
    .map((item) => item.chunk.path);
  const ranked = [...results].sort((a, b) => b.score - a.score).map((r) => r.chunk.path);
  return { text: packed.text, files: [...new Set(files)], rankedFiles: [...new Set(ranked)] };
}

/**
 * Runs a quick re-index if files changed, waiting at most `REFRESH_WAIT_MS`. A refresh that
 * takes longer keeps running in the background and `ctx.refreshPending` says so.
 */
export async function refreshIndex(ctx: ToolContext, waitMs = REFRESH_WAIT_MS): Promise<void> {
  ctx.refreshing ??= indexRepo(ctx.root, ctx.store, ctx.config, {
    quick: true,
    provider: ctx.provider,
  })
    .catch((error: unknown) => log.warn(`index refresh failed: ${String(error)}`))
    .finally(() => {
      ctx.refreshing = undefined;
      ctx.refreshPending = false;
    });
  let timer: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    ctx.refreshing.then(() => false),
    new Promise<boolean>((done) => {
      timer = setTimeout(() => done(true), waitMs);
    }),
  ]);
  clearTimeout(timer);
  ctx.refreshPending = timedOut;
}

/**
 * Runs one tool the way every caller should: refresh the index first, run, add the refresh
 * note when the index is behind, and log the query for `remimem stats`.
 */
export async function runTool(
  ctx: ToolContext,
  tool: ToolDefinition,
  args: Record<string, unknown>,
  options: { refresh?: boolean } = {},
): Promise<string> {
  const started = performance.now();
  if (options.refresh !== false && tool.name !== 'index_status') await refreshIndex(ctx);
  const result = await tool.run(ctx, args as never);
  const { text, files = [] } = typeof result === 'string' ? { text: result } : result;
  const answer = ctx.refreshPending ? `${text}\n${REFRESH_NOTE}` : text;
  const tokens = countTokens(answer);
  const queryText =
    args['task'] ??
    args['query'] ??
    args['name'] ??
    args['path'] ??
    args['text'] ??
    args['id'] ??
    '';
  try {
    ctx.store.logQuery({
      tool: tool.name,
      query: String(queryText).slice(0, 500),
      tokensReturned: tokens,
      // Reading the same code without remimem means reading those files in full.
      baselineTokens: Math.max(tokens, ctx.store.fileTokens(files)),
      latencyMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    log.warn(`could not log the query: ${String(error)}`);
  }
  return answer;
}

/**
 * Project memory for a task: memories linked to a result's file as a whole or to a symbol
 * in the results, then memories that match the task text. At most a quarter of the budget, so code keeps most of it.
 */
async function memoryBlock(
  ctx: ToolContext,
  task: string,
  results: { chunk: { path: string; symbol: string | null } }[],
  budget: number,
): Promise<string> {
  if (ctx.config.retrieval.memoryLimit === 0) return '';
  const matched = await recall(ctx.root, ctx.store, ctx.provider, task, ctx.config.retrieval, {
    limit: ctx.config.retrieval.memoryLimit,
  });
  const linked = linkedMemories(
    ctx.store,
    results.map((r) => ({ path: r.chunk.path, symbol: r.chunk.symbol })),
  );
  const seen = new Set<string>();
  const memories = [...linked, ...matched].filter((m: Memory) => !seen.has(m.id) && seen.add(m.id));
  const lines = ['=== Project memory (decisions and conventions recorded for this repo) ==='];
  for (const memory of memories) {
    const next = [...lines, formatMemory(memory)];
    if (countTokens(next.join('\n')) > budget / 4) break;
    lines.push(formatMemory(memory));
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

const budgetSchema = z
  .number()
  .int()
  .min(100)
  .max(100_000)
  .optional()
  .describe('Maximum tokens to return. Default 4000.');
const pathsSchema = z
  .array(z.string())
  .optional()
  .describe('Only return code from files matching these globs, e.g. ["src/api/**"].');

export interface ToolDefinition {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  /** False for tools that change project memory. */
  readOnly: boolean;
  run: (ctx: ToolContext, args: never) => Promise<string | ToolResult> | string | ToolResult;
}

function tool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: Shape,
  run: (
    ctx: ToolContext,
    args: z.infer<z.ZodObject<Shape>>,
  ) => Promise<string | ToolResult> | string | ToolResult,
  readOnly = true,
): ToolDefinition {
  return { name, description, shape, readOnly, run: run as ToolDefinition['run'] };
}

// Descriptions are loaded into the agent's context on every session: keep them short.
export const TOOLS: ToolDefinition[] = [
  tool(
    'get_context',
    'Best starting point for a coding task. Returns the most relevant code for the task within a token budget: full source of the top matches plus signatures of what they call and what calls them. Example: get_context({ task: "add rate limiting to the login endpoint" }).',
    {
      task: z.string().min(1).describe('What you are about to do, in plain language.'),
      budget_tokens: budgetSchema,
      paths: pathsSchema,
    },
    (ctx, args) =>
      query(ctx, args.task, {
        k: ctx.config.retrieval.contextK,
        budget: args.budget_tokens ?? ctx.config.retrieval.defaultBudgetTokens,
        paths: args.paths,
        memories: true,
      }),
  ),
  tool(
    'search_code',
    'Search the codebase by meaning and by identifier. Returns ranked code with the reason each result matched. Example: search_code({ query: "parse JWT token", k: 5 }).',
    {
      query: z.string().min(1).describe('Words, a description, or a symbol name.'),
      k: z.number().int().min(1).max(50).optional().describe('Number of results. Default 10.'),
      budget_tokens: budgetSchema,
      language: z.enum(LANGS as [string, ...string[]]).optional(),
      paths: pathsSchema,
    },
    (ctx, args) =>
      query(ctx, args.query, {
        k: args.k ?? ctx.config.retrieval.defaultK,
        budget: args.budget_tokens ?? ctx.config.retrieval.defaultBudgetTokens,
        language: args.language,
        paths: args.paths,
      }),
  ),
  tool(
    'get_symbol',
    'Fetch one function, class, or type by name, with its callers and callees. Use it to read a body that search returned as a signature. Example: get_symbol({ name: "UserService.login" }).',
    {
      name: z
        .string()
        .min(1)
        .describe('Plain or qualified name, e.g. "login" or "UserService.login".'),
      include: z.enum(['signature', 'body']).optional().describe('Default "body".'),
      depth: z
        .number()
        .int()
        .min(0)
        .max(2)
        .optional()
        .describe('Hops of callers and callees. Default 1.'),
    },
    (ctx, args) => {
      requireIndex(ctx);
      const files = ctx.store.symbolsNamed(args.name).map((symbol) => symbol.path);
      return {
        text: withTokens(describeSymbol(ctx.store, args.name, args)),
        files: [...new Set(files)].slice(0, 1),
      };
    },
  ),
  tool(
    'get_file_outline',
    'List the symbols in a file with signatures and line numbers, without bodies. Example: get_file_outline({ path: "src/auth.ts" }).',
    { path: z.string().min(1).describe('File path relative to the project root.') },
    (ctx, args) => {
      requireIndex(ctx);
      const path = args.path.replaceAll('\\', '/').replace(/^\.\//, '');
      return { text: withTokens(fileOutline(ctx.store, path)), files: [path] };
    },
  ),
  tool(
    'find_references',
    'Find where a symbol is called, extended, used as a type, or imported, as path:line grouped by file. Run it before changing a symbol. Example: find_references({ name: "findUser" }).',
    { name: z.string().min(1).describe('Plain or qualified symbol name.') },
    (ctx, args) => {
      requireIndex(ctx);
      return withTokens(findReferences(ctx.store, args.name));
    },
  ),
  tool(
    'remember',
    'Save a decision, convention, gotcha, or todo about this codebase so future sessions see it. Link it to files or symbols so it is shown with them and flagged when they change. Example: remember({ text: "Passwords are hashed with argon2, never bcrypt", kind: "decision", symbols: ["hash"] }).',
    {
      text: z.string().min(1).describe('The fact to keep, in one or two sentences.'),
      kind: z.enum(MEMORY_KINDS),
      paths: z.array(z.string()).optional().describe('Files this is about.'),
      symbols: z.array(z.string()).optional().describe('Symbols this is about.'),
      tags: z.array(z.string()).optional(),
    },
    (ctx, args) => {
      const { memory, unlinked } = remember(ctx.root, ctx.store, args);
      const links = memory.links.map((l) => (l.symbol ? `${l.path} ${l.symbol}` : l.path));
      return [
        `Stored memory ${memory.id} (${memory.kind})${links.length > 0 ? `, linked to ${links.join(', ')}` : ''}.`,
        ...unlinked.map((name) => `Not linked: ${name}.`),
      ].join('\n');
    },
    false,
  ),
  tool(
    'recall',
    'Search saved project memory: decisions, conventions, gotchas, todos. Stale ones (their linked code changed) are marked. Example: recall({ query: "password hashing" }).',
    {
      query: z.string().describe('What to look for. Empty lists everything.'),
      kind: z.enum(MEMORY_KINDS).optional(),
    },
    async (ctx, args) => {
      const memories = await recall(
        ctx.root,
        ctx.store,
        ctx.provider,
        args.query,
        ctx.config.retrieval,
        { kind: args.kind },
      );
      if (memories.length === 0) return 'No memories match.';
      return withTokens(memories.map(formatMemory).join('\n'));
    },
  ),
  tool(
    'forget',
    'Delete a saved memory by id, e.g. one that recall marked stale and is no longer true. Example: forget({ id: "m_3f9a2c1b" }).',
    { id: z.string().min(1).describe('The memory id, as shown by recall.') },
    (ctx, args) => {
      if (!forget(ctx.root, ctx.store, args.id)) {
        throw new RemimemError(`No memory with id ${args.id}. Use recall to list ids.`);
      }
      return `Forgot memory ${args.id}.`;
    },
    false,
  ),
  tool(
    'index_status',
    'Report what the remimem index covers: files, chunks, last indexed commit, pending changes, embedding model.',
    {},
    (ctx) => indexStatus(ctx),
  ),
];

/** The symbols of a file, nested ones indented under their parent. */
export function fileOutline(store: Store, rawPath: string): string {
  const path = rawPath.replaceAll('\\', '/').replace(/^\.\//, '');
  const language = store.fileLanguage(path);
  if (language === undefined)
    return `No file "${path}" in the index. Paths are relative to the project root.`;
  const symbols = store.symbolsInFile(path);
  if (symbols.length === 0) {
    return `${path} has no symbols in the index (it is searchable as plain text).`;
  }
  const depth = new Map<number, number>();
  const out = [`${path} (${language ?? 'text'}, ${symbols.length} symbols)`];
  for (const s of symbols) {
    const level = s.parentId === null ? 0 : (depth.get(s.parentId) ?? 0) + 1;
    depth.set(s.id, level);
    const indent = '  '.repeat(level);
    out.push(`${indent}${s.startLine}-${s.endLine} ${s.kind} ${s.name}`);
    for (const line of s.signature.split('\n')) out.push(`${indent}  ${line}`);
  }
  return out.join('\n');
}

export async function indexStatus(ctx: ToolContext): Promise<string> {
  const { store } = ctx;
  const counts = store.counts();
  if (counts.files === 0) return new EmptyIndexError().message;
  const pending = await pendingChanges(ctx.root, store, ctx.config);
  const commit = store.getMeta('last_indexed_commit');
  const model = store.embeddingModel();
  return [
    `Files: ${counts.files} | Symbols: ${counts.symbols} | Chunks: ${counts.chunks} | Edges: ${store.edgeCount()}`,
    `Last indexed: ${store.getMeta('last_indexed_at') ?? 'unknown'}${commit ? ` at commit ${commit.slice(0, 12)}` : ' (no git commit)'}`,
    `Pending changes: ${pending.changed} changed, ${pending.added} new, ${pending.deleted} deleted${pending.changed + pending.added + pending.deleted > 0 ? ' (run `remimem index`)' : ''}`,
    `Embedding model: ${model ? `${model} (${store.vectorCount()} of ${counts.chunks} chunks embedded)` : 'none (keyword search only)'}`,
    ...(ctx.dashboardUrl ? [`Dashboard: ${ctx.dashboardUrl}`] : []),
  ].join('\n');
}
