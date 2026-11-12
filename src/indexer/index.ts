import { readFile } from 'node:fs/promises';
import { chunkFile, type Chunk, type ChunkOptions } from '../chunker/index.js';
import { languageOf, parseSource, type ParsedFile } from '../parser/index.js';
import { resolveInRoot } from '../scanner/index.js';

export interface ProcessedFile {
  path: string;
  lineCount: number;
  parsed: ParsedFile | null;
  chunks: Chunk[];
}

/** Reads, parses, and chunks one file. `path` is relative to `root`. */
export async function processFile(
  root: string,
  path: string,
  opts?: ChunkOptions,
): Promise<ProcessedFile> {
  // Normalize line endings so line numbers and offsets agree on every platform.
  const source = (await readFile(resolveInRoot(root, path), 'utf8')).replace(/\r\n?/g, '\n');
  const language = languageOf(path);
  const parsed = language ? await parseSource(language, source) : null;
  const chunks = chunkFile(path, language, source, parsed, opts);
  const lineCount = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  return { path, lineCount, parsed, chunks };
}
