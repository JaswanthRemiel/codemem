import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chunkFile, type Chunk, type ChunkOptions } from '../chunker/index.js';
import type { Config } from '../config/index.js';
import { embedMissing, modelChanged, type EmbeddingProvider } from '../embedder/index.js';
import { execFileSync } from 'node:child_process';
import { updateGraph } from '../graph/index.js';
import { log } from '../log.js';
import { refreshStaleness, syncMemories } from '../memory/index.js';
import { buildOverview } from './overview.js';
import { languageOf, parseSource, type ParsedFile } from '../parser/index.js';
import { hasExcludedContent, listCandidates, resolveInRoot, scan } from '../scanner/index.js';
import type { Store } from '../store/index.js';
import { countTokens } from '../tokens.js';

/**
 * Bump when the parser or chunker changes what gets stored for an unchanged file, so
 * existing indexes are rebuilt instead of silently keeping the old shape.
 */
const INDEX_FORMAT = '3';
const BATCH_FILES = 100;

export interface ProcessedFile {
  path: string;
  language: string | null;
  contentHash: string;
  lineCount: number;
  parsed: ParsedFile | null;
  chunks: Chunk[];
}

export interface IndexStats {
  scanned: number;
  indexed: number;
  unchanged: number;
  deleted: number;
  /** Chunks written by this run. */
  chunks: number;
  /** Chunks that received a vector in this run, and how many of those came from the cache. */
  embedded: number;
  embeddingsCached: number;
  seconds: number;
}

export interface IndexOptions {
  full?: boolean;
  /** Trust size and modification time instead of hashing every file. */
  quick?: boolean;
  /** Null or missing leaves the index keyword-only. */
  provider?: EmbeddingProvider | null;
  onEmbedProgress?: (done: number, total: number) => void;
}

async function readSource(root: string, path: string): Promise<string> {
  // Normalize line endings so line numbers and offsets agree on every platform.
  return (await readFile(resolveInRoot(root, path), 'utf8')).replace(/\r\n?/g, '\n');
}

const hashOf = (source: string): string => createHash('sha256').update(source).digest('hex');

async function processSource(
  path: string,
  source: string,
  opts?: ChunkOptions,
): Promise<ProcessedFile> {
  const language = languageOf(path);
  const parsed = language ? await parseSource(language, source) : null;
  const chunks = chunkFile(path, language, source, parsed, opts);
  const lineCount = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  return { path, language, contentHash: hashOf(source), lineCount, parsed, chunks };
}

/** Reads, parses, and chunks one file. `path` is relative to `root`. */
export async function processFile(
  root: string,
  path: string,
  opts?: ChunkOptions,
): Promise<ProcessedFile> {
  return processSource(path, await readSource(root, path), opts);
}

/** The current git commit of `root`, or an empty string outside a git repo. */
function headCommit(root: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** How the files under `root` differ from the index, without changing anything. */
export async function pendingChanges(
  root: string,
  store: Store,
  config: Config,
): Promise<{ changed: number; added: number; deleted: number }> {
  const known = store.fileHashes();
  const result = { changed: 0, added: 0, deleted: 0 };
  const present = new Set<string>();
  for (const { path } of scan(root, config)) {
    present.add(path);
    const stored = known.get(path);
    if (stored === undefined) result.added++;
    else if (stored !== hashOf(await readSource(root, path))) result.changed++;
  }
  for (const path of known.keys()) if (!present.has(path)) result.deleted++;
  return result;
}

/** A modification time this close to the last look is not trusted: the content is hashed. */
const MTIME_MARGIN_MS = 2000;

/**
 * Brings the store in line with the files under `root`: changed files are re-read, files
 * that disappeared are removed, and the graph, overview, memories, and vectors follow.
 *
 * - default: every file is read and hashed, and only files whose hash changed are indexed.
 * - `quick`: a file whose size is unchanged and whose modification time is older than the
 *   last look is taken as unchanged without reading it. Used before tool calls and by
 *   `watch`, where the check runs often and must cost a few milliseconds.
 * - `full`: every file is indexed again.
 */
export async function indexRepo(
  root: string,
  store: Store,
  config: Config,
  options: IndexOptions = {},
): Promise<IndexStats> {
  const started = performance.now();
  const formatChanged = store.getMeta('index_format') !== INDEX_FORMAT;
  const full = options.full === true || formatChanged;
  const quick = options.quick === true && !full;
  const known = store.fileStates();
  const candidates = listCandidates(root, config);
  const stats: IndexStats = {
    scanned: 0,
    indexed: 0,
    unchanged: 0,
    deleted: 0,
    chunks: 0,
    embedded: 0,
    embeddingsCached: 0,
    seconds: 0,
  };

  let batch: { file: ProcessedFile; sizeBytes: number; readAt: number }[] = [];
  const flush = (): void => {
    store.transaction(() => {
      for (const { file, sizeBytes, readAt } of batch) {
        store.replaceFile(
          { ...file, sizeBytes, readAt },
          file.parsed,
          file.chunks.map((chunk) => ({ ...chunk, tokenCount: countTokens(chunk.content) })),
        );
      }
    });
    batch = [];
  };

  const present = new Set<string>();
  for (const { path, sizeBytes, mtimeMs } of candidates) {
    const state = known.get(path);
    if (
      quick &&
      state &&
      state.sizeBytes === sizeBytes &&
      mtimeMs < state.indexedAt - MTIME_MARGIN_MS
    ) {
      present.add(path);
      stats.scanned++;
      stats.unchanged++;
      continue;
    }
    // Only now is the content looked at: binary, minified, and generated files drop out.
    if (hasExcludedContent(resolveInRoot(root, path))) continue;
    present.add(path);
    stats.scanned++;
    const readAt = Date.now();
    const source = await readSource(root, path);
    if (!full && state?.hash === hashOf(source)) {
      stats.unchanged++;
      // Remember the look, so a recently touched file is not hashed on every quick check.
      if (quick) store.touchFile(path, readAt);
      continue;
    }
    const file = await processSource(path, source);
    batch.push({ file, sizeBytes, readAt });
    stats.indexed++;
    stats.chunks += file.chunks.length;
    if (batch.length >= BATCH_FILES) flush();
  }
  flush();

  store.transaction(() => {
    for (const path of known.keys()) {
      if (!present.has(path) && store.deleteFile(path)) stats.deleted++;
    }
    if (formatChanged) store.setMeta('index_format', INDEX_FORMAT);
  });
  const changed = stats.indexed > 0 || stats.deleted > 0;
  log.debug(
    `files: ${stats.indexed} indexed, ${stats.deleted} removed in ${Math.round(performance.now() - started)} ms`,
  );

  // Memories follow the code: pick up a changed memory.json, then re-check every link.
  syncMemories(root, store);
  if (quick && !changed) {
    stats.seconds = (performance.now() - started) / 1000;
    return stats;
  }

  // Name resolution depends on every file, so the graph is rebuilt whenever anything changed.
  if (changed || store.getMeta('overview') === undefined) {
    const graphStarted = performance.now();
    updateGraph(store);
    store.setMeta('overview', buildOverview(store));
    log.debug(`graph and overview rebuilt in ${Math.round(performance.now() - graphStarted)} ms`);
  }
  refreshStaleness(store);
  store.setMeta('last_indexed_at', new Date().toISOString());
  store.setMeta('last_indexed_commit', headCommit(root));

  const provider = options.provider;
  if (provider) {
    const embedStarted = performance.now();
    // A full rebuild is the way to switch models; anything else refuses to mix them.
    if (options.full && modelChanged(store, provider)) store.clearVectors();
    const embed = await embedMissing(
      store,
      provider,
      config.embedding.batchSize,
      options.onEmbedProgress,
    );
    stats.embedded = embed.embedded;
    stats.embeddingsCached = embed.cached;
    // A full run embeds every chunk, so it knows exactly which cached vectors are in use.
    store.pruneEmbeddingCache(provider.id, options.full ? embed.hashes : undefined);
    log.debug(
      `embedded ${embed.embedded} chunks in ${Math.round(performance.now() - embedStarted)} ms`,
    );
  }

  stats.seconds = (performance.now() - started) / 1000;
  return stats;
}
