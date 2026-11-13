import { matchesGlob } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import type { EmbeddingProvider } from '../embedder/index.js';
import { CodememError } from '../errors.js';
import { describeSymbol, findReferences } from '../graph/describe.js';
import { pendingChanges } from '../indexer/index.js';
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
}

export class EmptyIndexError extends CodememError {
  constructor() {
    super('The index is empty. Run `codemem index` (or `codemem init`) in the project first.');
  }
}

const withTokens = (text: string): string =>
  `${text}\n\n~${countTokens(text).toLocaleString('en-US')} tokens`;

function requireIndex(ctx: ToolContext): void {
  if (ctx.store.counts().files === 0) throw new EmptyIndexError();
}

interface QueryOptions {
  k: number;
  budget: number;
  language?: string | undefined;
  paths?: string[] | undefined;
}

/** Search, filter by language and path globs, and pack into the budget. */
async function query(ctx: ToolContext, text: string, options: QueryOptions): Promise<string> {
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
  return pack(results, options.budget).text;
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
  run: (ctx: ToolContext, args: never) => Promise<string> | string;
}

function tool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: Shape,
  run: (ctx: ToolContext, args: z.infer<z.ZodObject<Shape>>) => Promise<string> | string,
): ToolDefinition {
  return { name, description, shape, run: run as ToolDefinition['run'] };
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
      return withTokens(describeSymbol(ctx.store, args.name, args));
    },
  ),
  tool(
    'get_file_outline',
    'List the symbols in a file with signatures and line numbers, without bodies. Example: get_file_outline({ path: "src/auth.ts" }).',
    { path: z.string().min(1).describe('File path relative to the project root.') },
    (ctx, args) => {
      requireIndex(ctx);
      return withTokens(fileOutline(ctx.store, args.path));
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
    'index_status',
    'Report what the codemem index covers: files, chunks, last indexed commit, pending changes, embedding model.',
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
    `Pending changes: ${pending.changed} changed, ${pending.added} new, ${pending.deleted} deleted${pending.changed + pending.added + pending.deleted > 0 ? ' (run `codemem index`)' : ''}`,
    `Embedding model: ${model ? `${model} (${store.vectorCount()} of ${counts.chunks} chunks embedded)` : 'none (keyword search only)'}`,
  ].join('\n');
}
