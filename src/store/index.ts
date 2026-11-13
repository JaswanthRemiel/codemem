import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { Chunk } from '../chunker/index.js';
import { StoreError } from '../errors.js';
import type { CodeSymbol } from '../parser/index.js';
import { expandForIndex } from './fts.js';

/** One entry per schema version. Never edit an entry that has shipped; append a new one. */
const MIGRATIONS = [
  `
  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    language TEXT,
    content_hash TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
  );
  CREATE TABLE symbols (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    signature TEXT NOT NULL,
    docstring TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    parent_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE
  );
  CREATE INDEX symbols_file ON symbols(file_id);
  CREATE INDEX symbols_name ON symbols(name);
  CREATE INDEX symbols_qualified_name ON symbols(qualified_name);
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL
  );
  CREATE INDEX chunks_file ON chunks(file_id);
  CREATE INDEX chunks_symbol ON chunks(symbol_id);
  -- Contentless: the expanded text is only searched, never read back.
  CREATE VIRTUAL TABLE chunks_fts USING fts5(
    content, symbol, path,
    content='', contentless_delete=1,
    tokenize="unicode61 tokenchars '_$'"
  );
  `,
  `
  -- Vectors by hash of the embedded text, so unchanged chunks are never embedded twice.
  CREATE TABLE embedding_cache (
    text_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    embedding BLOB NOT NULL,
    PRIMARY KEY (text_hash, model_id)
  ) WITHOUT ROWID;
  `,
];

export interface FileRecord {
  path: string;
  language: string | null;
  contentHash: string;
  sizeBytes: number;
}

export type StoredChunk = Chunk & { tokenCount: number };

/** A chunk as search results need it, joined with its file and symbol. */
export interface ChunkRow {
  id: number;
  path: string;
  language: string | null;
  startLine: number;
  endLine: number;
  content: string;
  tokenCount: number;
  /** Qualified symbol name, or null for a line-window chunk. */
  symbol: string | null;
  kind: string;
  signature: string;
  docstring: string;
}

export interface KeywordWeights {
  content: number;
  symbol: number;
  path: number;
}

const CHUNK_ROW = `
  SELECT c.id, f.path, f.language, c.start_line AS startLine, c.end_line AS endLine,
         c.content, c.token_count AS tokenCount, s.qualified_name AS symbol,
         COALESCE(s.kind, 'window') AS kind, COALESCE(s.signature, '') AS signature,
         COALESCE(s.docstring, '') AS docstring
  FROM chunks c
  JOIN files f ON f.id = c.file_id
  LEFT JOIN symbols s ON s.id = c.symbol_id`;

/** All SQLite access. No other module writes SQL. */
export class Store {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    try {
      sqliteVec.load(this.db);
    } catch (cause) {
      this.db.close();
      throw new StoreError('The sqlite-vec extension failed to load; run `codemem doctor`', {
        cause,
      });
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const current = Number(this.getMeta('schema_version') ?? 0);
    if (current > MIGRATIONS.length) {
      throw new StoreError(
        `The index was written by a newer codemem (schema ${current}); upgrade codemem or delete .codemem/index.db and run \`codemem index\``,
      );
    }
    for (let version = current; version < MIGRATIONS.length; version++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[version] as string);
        this.setMeta('schema_version', String(version + 1));
      });
    }
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  /** Path to content hash for every indexed file. */
  fileHashes(): Map<string, string> {
    const rows = this.db.prepare('SELECT path, content_hash AS hash FROM files').all() as {
      path: string;
      hash: string;
    }[];
    return new Map(rows.map((row) => [row.path, row.hash]));
  }

  counts(): { files: number; symbols: number; chunks: number } {
    return this.db
      .prepare(
        'SELECT (SELECT COUNT(*) FROM files) AS files, (SELECT COUNT(*) FROM symbols) AS symbols, (SELECT COUNT(*) FROM chunks) AS chunks',
      )
      .get() as { files: number; symbols: number; chunks: number };
  }

  /** Removes a file with its symbols, chunks, and search entries. Returns false if unknown. */
  deleteFile(path: string): boolean {
    const file = this.db.prepare('SELECT id FROM files WHERE path = ?').get(path) as
      { id: number } | undefined;
    if (!file) return false;
    this.db
      .prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE file_id = ?)')
      .run(file.id);
    if (this.hasVectors()) {
      this.db
        .prepare(
          'DELETE FROM chunk_vectors WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?)',
        )
        .run(file.id);
    }
    this.db.prepare('DELETE FROM files WHERE id = ?').run(file.id); // cascades
    return true;
  }

  /** Replaces everything stored for one file. Call inside `transaction`. */
  replaceFile(file: FileRecord, symbols: CodeSymbol[], chunks: StoredChunk[]): void {
    this.deleteFile(file.path);
    const fileId = this.db
      .prepare(
        'INSERT INTO files (path, language, content_hash, size_bytes, indexed_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(file.path, file.language, file.contentHash, file.sizeBytes, Date.now()).lastInsertRowid;

    const insertSymbol = this.db.prepare(
      'INSERT INTO symbols (file_id, name, qualified_name, kind, signature, docstring, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const symbolIds = symbols.map(
      (s) =>
        insertSymbol.run(
          fileId,
          s.name,
          s.qualifiedName,
          s.kind,
          s.signature,
          s.docstring,
          s.startLine,
          s.endLine,
        ).lastInsertRowid,
    );
    // A parent can come after its child (a Go method declared above its type).
    const setParent = this.db.prepare('UPDATE symbols SET parent_id = ? WHERE id = ?');
    for (const [i, s] of symbols.entries()) {
      if (s.parent !== null) setParent.run(symbolIds[s.parent], symbolIds[i]);
    }

    const insertChunk = this.db.prepare(
      'INSERT INTO chunks (file_id, symbol_id, content, content_hash, token_count, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const insertFts = this.db.prepare(
      'INSERT INTO chunks_fts (rowid, content, symbol, path) VALUES (?, ?, ?, ?)',
    );
    const pathTerms = expandForIndex(file.path);
    for (const c of chunks) {
      const chunkId = insertChunk.run(
        fileId,
        c.symbolIndex === null ? null : symbolIds[c.symbolIndex],
        c.content,
        c.contentHash,
        c.tokenCount,
        c.startLine,
        c.endLine,
      ).lastInsertRowid;
      insertFts.run(chunkId, expandForIndex(c.content), expandForIndex(c.symbol ?? ''), pathTerms);
    }
  }

  /** BM25 keyword search. `match` is an FTS5 query; higher scores are better. */
  keywordSearch(
    match: string,
    limit: number,
    weights: KeywordWeights,
  ): { id: number; score: number }[] {
    return this.db
      .prepare(
        'SELECT rowid AS id, -bm25(chunks_fts, ?, ?, ?) AS score FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY score DESC LIMIT ?',
      )
      .all(weights.content, weights.symbol, weights.path, match, limit) as {
      id: number;
      score: number;
    }[];
  }

  /**
   * Chunk ids for symbols whose name or qualified name is one of `names`. A symbol without
   * its own chunk (a constant or a nested function) maps to the chunk that contains it.
   */
  chunkIdsForSymbols(names: string[]): number[] {
    if (names.length === 0) return [];
    const marks = names.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT (
           SELECT c.id FROM chunks c
           WHERE c.file_id = s.file_id AND c.start_line <= s.start_line AND c.end_line >= s.start_line
           ORDER BY c.symbol_id IS s.id DESC, c.end_line - c.start_line, c.id LIMIT 1
         ) AS id
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.name IN (${marks}) OR s.qualified_name IN (${marks})
         ORDER BY f.path, s.start_line`,
      )
      .all(...names, ...names) as { id: number | null }[];
    return [...new Set(rows.flatMap((row) => (row.id === null ? [] : [row.id])))];
  }

  /** Loads chunks by id, in the order given. */
  getChunks(ids: number[]): ChunkRow[] {
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(`${CHUNK_ROW} WHERE c.id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids) as ChunkRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  // Vectors. The `chunk_vectors` table is created on demand because its dimension depends
  // on the embedding model; `meta` records which model filled it.

  private hasVectors(): boolean {
    return this.getMeta('embedding_dim') !== undefined;
  }

  /** The model that produced the stored vectors, or undefined when there are none. */
  embeddingModel(): string | undefined {
    return this.hasVectors() ? this.getMeta('embedding_model') : undefined;
  }

  /** Forgets every stored vector, for a rebuild with a different model. */
  clearVectors(): void {
    this.transaction(() => {
      this.db.exec('DROP TABLE IF EXISTS chunk_vectors');
      this.db.prepare("DELETE FROM meta WHERE key IN ('embedding_model', 'embedding_dim')").run();
    });
  }

  /** Drops every stored vector and prepares the table for `modelId` with `dim` dimensions. */
  resetVectors(modelId: string, dim: number): void {
    if (!Number.isInteger(dim) || dim <= 0) throw new StoreError(`Invalid embedding size: ${dim}`);
    this.transaction(() => {
      this.db.exec('DROP TABLE IF EXISTS chunk_vectors');
      this.db.exec(
        `CREATE VIRTUAL TABLE chunk_vectors USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${dim}] distance_metric=cosine)`,
      );
      this.setMeta('embedding_model', modelId);
      this.setMeta('embedding_dim', String(dim));
    });
  }

  /** Chunks that have no vector yet, shortest first so batches pad less. */
  chunksWithoutVectors(): { id: number; path: string; content: string }[] {
    const join = this.hasVectors()
      ? 'LEFT JOIN chunk_vectors v ON v.chunk_id = c.id WHERE v.chunk_id IS NULL'
      : '';
    return this.db
      .prepare(
        `SELECT c.id, f.path, c.content FROM chunks c JOIN files f ON f.id = c.file_id ${join} ORDER BY length(c.content)`,
      )
      .all() as { id: number; path: string; content: string }[];
  }

  setVector(chunkId: number, embedding: Float32Array): void {
    this.db
      .prepare('INSERT OR REPLACE INTO chunk_vectors (chunk_id, embedding) VALUES (?, ?)')
      .run(BigInt(chunkId), embedding);
  }

  cachedEmbedding(textHash: string, modelId: string): Float32Array | undefined {
    const row = this.db
      .prepare('SELECT embedding FROM embedding_cache WHERE text_hash = ? AND model_id = ?')
      .get(textHash, modelId) as { embedding: Buffer } | undefined;
    if (!row) return undefined;
    const { buffer, byteOffset, byteLength } = row.embedding;
    return new Float32Array(buffer.slice(byteOffset, byteOffset + byteLength));
  }

  cacheEmbedding(textHash: string, modelId: string, embedding: Float32Array): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO embedding_cache (text_hash, model_id, embedding) VALUES (?, ?, ?)',
      )
      .run(
        textHash,
        modelId,
        Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength),
      );
  }

  /** Removes cached vectors of other models. Returns how many rows were removed. */
  pruneEmbeddingCache(modelId: string): number {
    return this.db.prepare('DELETE FROM embedding_cache WHERE model_id <> ?').run(modelId).changes;
  }

  /** Nearest chunks by cosine similarity; higher scores are closer. */
  vectorSearch(embedding: Float32Array, limit: number): { id: number; score: number }[] {
    if (!this.hasVectors()) return [];
    return this.db
      .prepare(
        'SELECT chunk_id AS id, 1 - distance AS score FROM chunk_vectors WHERE embedding MATCH ? AND k = ? ORDER BY distance',
      )
      .all(embedding, limit) as { id: number; score: number }[];
  }
}
