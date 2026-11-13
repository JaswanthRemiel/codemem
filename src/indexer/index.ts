import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chunkFile, type Chunk, type ChunkOptions } from '../chunker/index.js';
import type { Config } from '../config/index.js';
import { languageOf, parseSource, type ParsedFile } from '../parser/index.js';
import { resolveInRoot, scan } from '../scanner/index.js';
import type { Store } from '../store/index.js';
import { countTokens } from '../tokens.js';

/**
 * Bump when the parser or chunker changes what gets stored for an unchanged file, so
 * existing indexes are rebuilt instead of silently keeping the old shape.
 */
const INDEX_FORMAT = '1';
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
  seconds: number;
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

/**
 * Brings the store in line with the files under `root`. Files whose content hash is
 * unchanged are skipped unless `full` is set; files that disappeared are removed.
 */
export async function indexRepo(
  root: string,
  store: Store,
  config: Config,
  options: { full?: boolean } = {},
): Promise<IndexStats> {
  const started = performance.now();
  const full = options.full === true || store.getMeta('index_format') !== INDEX_FORMAT;
  const known = store.fileHashes();
  const files = scan(root, config);
  const stats: IndexStats = {
    scanned: files.length,
    indexed: 0,
    unchanged: 0,
    deleted: 0,
    chunks: 0,
    seconds: 0,
  };

  let batch: { file: ProcessedFile; sizeBytes: number }[] = [];
  const flush = (): void => {
    store.transaction(() => {
      for (const { file, sizeBytes } of batch) {
        store.replaceFile(
          { ...file, sizeBytes },
          file.parsed?.symbols ?? [],
          file.chunks.map((chunk) => ({ ...chunk, tokenCount: countTokens(chunk.content) })),
        );
      }
    });
    batch = [];
  };

  for (const { path, sizeBytes } of files) {
    const source = await readSource(root, path);
    if (!full && known.get(path) === hashOf(source)) {
      stats.unchanged++;
      continue;
    }
    const file = await processSource(path, source);
    batch.push({ file, sizeBytes });
    stats.indexed++;
    stats.chunks += file.chunks.length;
    if (batch.length >= BATCH_FILES) flush();
  }
  flush();

  const present = new Set(files.map((file) => file.path));
  store.transaction(() => {
    for (const path of known.keys()) {
      if (!present.has(path) && store.deleteFile(path)) stats.deleted++;
    }
    store.setMeta('index_format', INDEX_FORMAT);
  });

  stats.seconds = (performance.now() - started) / 1000;
  return stats;
}
