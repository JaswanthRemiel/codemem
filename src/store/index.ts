import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { Chunk } from '../chunker/index.js';
import { StoreError } from '../errors.js';
import type { ParsedFile } from '../parser/index.js';
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
  `
  -- Mentions of other symbols by name. The graph module fills in the target columns.
  CREATE TABLE refs (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    receiver TEXT,
    line INTEGER NOT NULL,
    target_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
    confidence TEXT
  );
  CREATE INDEX refs_file ON refs(file_id);
  CREATE INDEX refs_symbol ON refs(symbol_id);
  CREATE INDEX refs_target ON refs(target_symbol_id);
  CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    name TEXT NOT NULL,
    local TEXT NOT NULL,
    line INTEGER NOT NULL,
    target_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL
  );
  CREATE INDEX imports_file ON imports(file_id);
  CREATE INDEX imports_target ON imports(target_symbol_id);
  -- One row per resolved relation between two symbols, derived from refs.
  CREATE TABLE edges (
    src_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    dst_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    confidence TEXT NOT NULL,
    PRIMARY KEY (src_symbol_id, dst_symbol_id, kind)
  ) WITHOUT ROWID;
  CREATE INDEX edges_dst ON edges(dst_symbol_id);
  `,
  `
  -- Project memory. Text ids, so memories shared through git do not collide.
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    tags TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    stale INTEGER NOT NULL DEFAULT 0,
    embedding BLOB,
    embedding_model TEXT
  );
  CREATE TABLE memory_links (
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    symbol_qualified_name TEXT,
    content_hash_at_link TEXT NOT NULL
  );
  CREATE INDEX memory_links_memory ON memory_links(memory_id);
  CREATE INDEX memory_links_path ON memory_links(file_path);
  CREATE VIRTUAL TABLE memories_fts USING fts5(
    text, tags,
    content='', contentless_delete=1,
    tokenize="unicode61 tokenchars '_$'"
  );
  `,
  `
  CREATE TABLE query_log (
    id INTEGER PRIMARY KEY,
    tool TEXT NOT NULL,
    query TEXT NOT NULL,
    tokens_returned INTEGER NOT NULL,
    baseline_tokens_estimate INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
];

export interface FileRecord {
  path: string;
  language: string | null;
  contentHash: string;
  sizeBytes: number;
  /** When the file was read, in milliseconds since the epoch. */
  readAt: number;
}

export type StoredChunk = Chunk & { tokenCount: number };

/** A chunk as search results need it, joined with its file and symbol. */
export interface ChunkRow {
  id: number;
  /** Id of the chunk's symbol, or null for a line-window chunk. */
  symbolId: number | null;
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

export interface GraphInput {
  files: { id: number; path: string; language: string | null }[];
  symbols: {
    id: number;
    fileId: number;
    name: string;
    qualifiedName: string;
    kind: string;
    parentId: number | null;
  }[];
  refs: {
    id: number;
    fileId: number;
    symbolId: number | null;
    kind: string;
    name: string;
    receiver: string | null;
  }[];
  imports: { id: number; fileId: number; source: string; name: string; local: string }[];
  /** Go module roots: the directory of each go.mod and the module path it declares. */
  goModules: { dir: string; module: string }[];
}

export interface SymbolRow {
  id: number;
  path: string;
  name: string;
  qualifiedName: string;
  kind: string;
  signature: string;
  docstring: string;
  startLine: number;
  endLine: number;
}

export interface Neighbor extends SymbolRow {
  /** The symbol this row is a neighbor of. */
  of: number;
  /** `calls`, `calls by`, `extends`, `extends by`, `uses-type`, `inside`, `contains`, ... */
  relation: string;
  confidence: string;
}

export interface Reference {
  path: string;
  line: number;
  /** `call`, `extends`, `implements`, `type`, or `import`. */
  kind: string;
  confidence: string;
  /** Qualified name of the symbol the mention is in, or null at file level. */
  fromSymbol: string | null;
}

const SYMBOL_ROW = `
  SELECT s.id, f.path, s.name, s.qualified_name AS qualifiedName, s.kind, s.signature,
         s.docstring, s.start_line AS startLine, s.end_line AS endLine
  FROM symbols s JOIN files f ON f.id = s.file_id`;

export interface QueryLogEntry {
  tool: string;
  query: string;
  tokensReturned: number;
  /** Estimated tokens to reach the same code by reading whole files. */
  baselineTokens: number;
  latencyMs: number;
}

export interface QueryLogSummary {
  tool: string;
  queries: number;
  tokensReturned: number;
  baselineTokens: number;
  meanLatencyMs: number;
  since: string;
}

export interface MemoryLink {
  path: string;
  /** Qualified symbol name, or null when the memory is about the whole file. */
  symbol: string | null;
  /** Hash of the linked code when the link was made. */
  contentHash: string;
}

export interface MemoryRow {
  id: string;
  kind: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** True when linked code has changed since the memory was written. */
  stale: boolean;
  links: MemoryLink[];
}

/** What the embedder needs to build the text for one chunk. */
export interface EmbeddingInput {
  id: number;
  path: string;
  content: string;
  signature: string;
  docstring: string;
  docLines: number;
}

export interface KeywordWeights {
  content: number;
  symbol: number;
  path: number;
}

const CHUNK_ROW = `
  SELECT c.id, c.symbol_id AS symbolId, f.path, f.language, c.start_line AS startLine, c.end_line AS endLine,
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
      throw new StoreError('The sqlite-vec extension failed to load; run `remimem doctor`', {
        cause,
      });
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    // The MCP server, `watch`, and the CLI can write to the same index: wait instead of failing.
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const current = Number(this.getMeta('schema_version') ?? 0);
    if (current > MIGRATIONS.length) {
      throw new StoreError(
        `The index was written by a newer remimem (schema ${current}); upgrade remimem or delete .remimem/index.db and run \`remimem index\``,
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

  /** What is known about every indexed file, for deciding whether it changed. */
  fileStates(): Map<string, { hash: string; sizeBytes: number; indexedAt: number }> {
    const rows = this.db
      .prepare(
        'SELECT path, content_hash AS hash, size_bytes AS sizeBytes, indexed_at AS indexedAt FROM files',
      )
      .all() as { path: string; hash: string; sizeBytes: number; indexedAt: number }[];
    return new Map(rows.map(({ path, ...state }) => [path, state]));
  }

  /** Records that a file was looked at and found unchanged. */
  touchFile(path: string, indexedAt: number): void {
    this.db.prepare('UPDATE files SET indexed_at = ? WHERE path = ?').run(indexedAt, path);
  }

  /** Approximate tokens of each whole file, from its chunks. */
  fileTokens(paths: string[]): number {
    if (paths.length === 0) return 0;
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(c.token_count), 0) AS n FROM chunks c JOIN files f ON f.id = c.file_id
         WHERE f.path IN (${paths.map(() => '?').join(', ')})`,
      )
      .get(...paths) as { n: number };
    return row.n;
  }

  logQuery(entry: QueryLogEntry): void {
    this.db
      .prepare(
        'INSERT INTO query_log (tool, query, tokens_returned, baseline_tokens_estimate, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        entry.tool,
        entry.query,
        entry.tokensReturned,
        entry.baselineTokens,
        entry.latencyMs,
        new Date().toISOString(),
      );
  }

  /** Queries and tokens per day, oldest first, for the dashboard's savings chart. */
  queryLogDaily(): {
    day: string;
    queries: number;
    tokensReturned: number;
    baselineTokens: number;
  }[] {
    return this.db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS queries,
                SUM(tokens_returned) AS tokensReturned, SUM(baseline_tokens_estimate) AS baselineTokens
         FROM query_log GROUP BY day ORDER BY day`,
      )
      .all() as { day: string; queries: number; tokensReturned: number; baselineTokens: number }[];
  }

  /** Every file with its language and number of symbols, for the dashboard's graph. */
  fileSummaries(): { path: string; language: string | null; symbols: number }[] {
    return this.db
      .prepare(
        `SELECT f.path, f.language, COUNT(s.id) AS symbols
         FROM files f LEFT JOIN symbols s ON s.file_id = f.id GROUP BY f.id ORDER BY f.path`,
      )
      .all() as { path: string; language: string | null; symbols: number }[];
  }

  /** Resolved symbol edges summed per pair of different files. */
  fileEdges(): { src: string; dst: string; weight: number }[] {
    return this.db
      .prepare(
        `SELECT sf.path AS src, df.path AS dst, COUNT(*) AS weight
         FROM edges e
         JOIN symbols s ON s.id = e.src_symbol_id JOIN files sf ON sf.id = s.file_id
         JOIN symbols d ON d.id = e.dst_symbol_id JOIN files df ON df.id = d.file_id
         WHERE sf.id <> df.id GROUP BY sf.id, df.id`,
      )
      .all() as { src: string; dst: string; weight: number }[];
  }

  /** Totals per tool over the whole query log. */
  queryLogSummary(): QueryLogSummary[] {
    return this.db
      .prepare(
        `SELECT tool, COUNT(*) AS queries, SUM(tokens_returned) AS tokensReturned,
                SUM(baseline_tokens_estimate) AS baselineTokens, CAST(AVG(latency_ms) AS INTEGER) AS meanLatencyMs,
                MIN(created_at) AS since
         FROM query_log GROUP BY tool ORDER BY queries DESC, tool`,
      )
      .all() as QueryLogSummary[];
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
  replaceFile(file: FileRecord, parsed: ParsedFile | null, chunks: StoredChunk[]): void {
    const symbols = parsed?.symbols ?? [];
    this.deleteFile(file.path);
    const fileId = this.db
      .prepare(
        'INSERT INTO files (path, language, content_hash, size_bytes, indexed_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(file.path, file.language, file.contentHash, file.sizeBytes, file.readAt).lastInsertRowid;

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

    const insertRef = this.db.prepare(
      'INSERT INTO refs (file_id, symbol_id, kind, name, receiver, line) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const r of parsed?.refs ?? []) {
      insertRef.run(
        fileId,
        r.from === null ? null : symbolIds[r.from],
        r.kind,
        r.name,
        r.receiver,
        r.line,
      );
    }
    const insertImport = this.db.prepare(
      'INSERT INTO imports (file_id, source, name, local, line) VALUES (?, ?, ?, ?, ?)',
    );
    for (const i of parsed?.imports ?? [])
      insertImport.run(fileId, i.source, i.name, i.local, i.line);
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

  // Graph. `refs` and `imports` hold what the parser saw; the graph module resolves them
  // and stores the result through `saveResolution`.

  /** Everything the graph module needs to resolve references. */
  graphInput(): GraphInput {
    const all = <T>(sql: string): T[] => this.db.prepare(sql).all() as T[];
    return {
      files: all('SELECT id, path, language FROM files'),
      symbols: all(
        'SELECT id, file_id AS fileId, name, qualified_name AS qualifiedName, kind, parent_id AS parentId FROM symbols',
      ),
      refs: all(
        'SELECT id, file_id AS fileId, symbol_id AS symbolId, kind, name, receiver FROM refs',
      ),
      imports: all('SELECT id, file_id AS fileId, source, name, local FROM imports'),
      goModules: all<{ path: string; content: string }>(
        "SELECT f.path, c.content FROM files f JOIN chunks c ON c.file_id = f.id WHERE (f.path = 'go.mod' OR f.path LIKE '%/go.mod') AND c.start_line = 1",
      ).flatMap(({ path, content }) => {
        const module = /^module\s+(\S+)/m.exec(content)?.[1];
        return module ? [{ dir: path.slice(0, -'go.mod'.length).replace(/\/$/, ''), module }] : [];
      }),
    };
  }

  /** Replaces every resolved target and rebuilds `edges` from them. */
  saveResolution(
    refs: { id: number; target: number; confidence: string }[],
    imports: { id: number; target: number }[],
  ): void {
    this.transaction(() => {
      this.db.exec(
        'UPDATE refs SET target_symbol_id = NULL, confidence = NULL WHERE target_symbol_id IS NOT NULL',
      );
      this.db.exec('UPDATE imports SET target_symbol_id = NULL WHERE target_symbol_id IS NOT NULL');
      const setRef = this.db.prepare(
        'UPDATE refs SET target_symbol_id = ?, confidence = ? WHERE id = ?',
      );
      for (const r of refs) setRef.run(r.target, r.confidence, r.id);
      const setImport = this.db.prepare('UPDATE imports SET target_symbol_id = ? WHERE id = ?');
      for (const i of imports) setImport.run(i.target, i.id);
      this.db.exec('DELETE FROM edges');
      // When several references link the same pair, the most certain one names the edge.
      this.db.exec(`
        INSERT INTO edges (src_symbol_id, dst_symbol_id, kind, confidence)
        SELECT symbol_id, target_symbol_id,
               CASE kind WHEN 'call' THEN 'calls' WHEN 'type' THEN 'uses-type' ELSE kind END,
               CASE MIN(CASE confidence WHEN 'exact' THEN 0 WHEN 'import' THEN 1 ELSE 2 END)
                 WHEN 0 THEN 'exact' WHEN 1 THEN 'import' ELSE 'name-match' END
        FROM refs
        WHERE symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL AND symbol_id <> target_symbol_id
        GROUP BY 1, 2, 3`);
    });
  }

  edgeCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM edges').get() as { n: number }).n;
  }

  /** Symbols whose name or qualified name is `name`. */
  symbolsNamed(name: string): SymbolRow[] {
    return this.db
      .prepare(
        `${SYMBOL_ROW} WHERE s.name = ? OR s.qualified_name = ? ORDER BY f.path, s.start_line`,
      )
      .all(name, name) as SymbolRow[];
  }

  /**
   * Direct neighbors of the given symbols: both directions of every edge, plus the
   * enclosing symbol (`inside`) and the enclosed ones (`contains`).
   */
  neighbors(symbolIds: number[]): Neighbor[] {
    if (symbolIds.length === 0) return [];
    const marks = symbolIds.map(() => '?').join(', ');
    return this.db
      .prepare(
        `SELECT n.of, n.relation, n.confidence, s.id, f.path, s.name, s.qualified_name AS qualifiedName,
                s.kind, s.signature, s.docstring, s.start_line AS startLine, s.end_line AS endLine
         FROM (
           SELECT src_symbol_id AS of, dst_symbol_id AS other, kind AS relation, confidence
             FROM edges WHERE src_symbol_id IN (${marks})
           UNION ALL
           SELECT dst_symbol_id, src_symbol_id, kind || ' by', confidence
             FROM edges WHERE dst_symbol_id IN (${marks})
           UNION ALL
           SELECT id, parent_id, 'inside', 'exact' FROM symbols
             WHERE id IN (${marks}) AND parent_id IS NOT NULL
           UNION ALL
           SELECT parent_id, id, 'contains', 'exact' FROM symbols WHERE parent_id IN (${marks})
         ) n
         JOIN symbols s ON s.id = n.other JOIN files f ON f.id = s.file_id
         ORDER BY n.of, n.relation, f.path, s.start_line`,
      )
      .all(...symbolIds, ...symbolIds, ...symbolIds, ...symbolIds) as Neighbor[];
  }

  /** The chunk that shows a symbol: its own, or the one containing it. */
  chunkIdForSymbol(symbolId: number): number | undefined {
    const row = this.db
      .prepare(
        `SELECT c.id FROM symbols s JOIN chunks c ON c.file_id = s.file_id
         WHERE s.id = ? AND c.start_line <= s.start_line AND c.end_line >= s.start_line
         ORDER BY c.symbol_id IS s.id DESC, c.end_line - c.start_line, c.id LIMIT 1`,
      )
      .get(symbolId) as { id: number } | undefined;
    return row?.id;
  }

  /** The symbols of one file in line order, with the id of each one's enclosing symbol. */
  symbolsInFile(path: string): (SymbolRow & { parentId: number | null })[] {
    return this.db
      .prepare(
        `SELECT s.id, f.path, s.name, s.qualified_name AS qualifiedName, s.kind, s.signature,
                s.docstring, s.start_line AS startLine, s.end_line AS endLine, s.parent_id AS parentId
         FROM symbols s JOIN files f ON f.id = s.file_id WHERE f.path = ? ORDER BY s.start_line, s.id`,
      )
      .all(path) as (SymbolRow & { parentId: number | null })[];
  }

  fileLanguage(path: string): string | null | undefined {
    const row = this.db.prepare('SELECT language FROM files WHERE path = ?').get(path) as
      { language: string | null } | undefined;
    return row ? row.language : undefined;
  }

  /** Every file path, and every top-level symbol that something refers to. */
  overviewInput(): {
    files: string[];
    symbols: { path: string; name: string; references: number }[];
  } {
    return {
      files: (this.db.prepare('SELECT path FROM files').all() as { path: string }[]).map(
        (f) => f.path,
      ),
      symbols: this.db
        .prepare(
          `SELECT f.path, s.qualified_name AS name, COUNT(r.id) AS "references"
           FROM symbols s JOIN files f ON f.id = s.file_id JOIN refs r ON r.target_symbol_id = s.id
           WHERE s.parent_id IS NULL AND s.kind <> 'constant' GROUP BY s.id`,
        )
        .all() as { path: string; name: string; references: number }[],
    };
  }

  /** How many chunks have a vector. */
  vectorCount(): number {
    if (!this.hasVectors()) return 0;
    return (this.db.prepare('SELECT COUNT(*) AS n FROM chunk_vectors').get() as { n: number }).n;
  }

  /** The chunks that make up a symbol, or the chunk containing it when it has none. */
  chunksOfSymbol(symbolId: number): ChunkRow[] {
    const own = this.db
      .prepare(`${CHUNK_ROW} WHERE c.symbol_id = ? ORDER BY c.start_line`)
      .all(symbolId) as ChunkRow[];
    if (own.length > 0) return own;
    const containing = this.chunkIdForSymbol(symbolId);
    return containing === undefined ? [] : this.getChunks([containing]);
  }

  /** Every resolved mention of the given symbols, and every import of them. */
  referencesTo(symbolIds: number[]): Reference[] {
    if (symbolIds.length === 0) return [];
    const marks = symbolIds.map(() => '?').join(', ');
    return this.db
      .prepare(
        `SELECT f.path, r.line, r.kind, r.confidence, s.qualified_name AS fromSymbol
           FROM refs r JOIN files f ON f.id = r.file_id LEFT JOIN symbols s ON s.id = r.symbol_id
           WHERE r.target_symbol_id IN (${marks})
         UNION ALL
         SELECT f.path, i.line, 'import', 'import', NULL
           FROM imports i JOIN files f ON f.id = i.file_id WHERE i.target_symbol_id IN (${marks})
         ORDER BY 1, 2`,
      )
      .all(...symbolIds, ...symbolIds) as Reference[];
  }

  // Memory. The memory module owns the rules; these are its storage operations.

  /** Replaces one memory, or adds it. Call inside `transaction`. */
  putMemory(memory: Omit<MemoryRow, 'stale'>): void {
    this.deleteMemory(memory.id);
    const { lastInsertRowid } = this.db
      .prepare(
        'INSERT INTO memories (id, kind, text, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        memory.id,
        memory.kind,
        memory.text,
        JSON.stringify(memory.tags),
        memory.createdAt,
        memory.updatedAt,
      );
    this.db
      .prepare('INSERT INTO memories_fts (rowid, text, tags) VALUES (?, ?, ?)')
      .run(lastInsertRowid, expandForIndex(memory.text), expandForIndex(memory.tags.join(' ')));
    const link = this.db.prepare(
      'INSERT INTO memory_links (memory_id, file_path, symbol_qualified_name, content_hash_at_link) VALUES (?, ?, ?, ?)',
    );
    for (const l of memory.links) link.run(memory.id, l.path, l.symbol, l.contentHash);
  }

  deleteMemory(id: string): boolean {
    const row = this.db.prepare('SELECT rowid FROM memories WHERE id = ?').get(id) as
      { rowid: number } | undefined;
    if (!row) return false;
    this.db.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(row.rowid);
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id); // links cascade
    return true;
  }

  /** Every memory, oldest first (insertion order within a millisecond), optionally of one kind. */
  listMemories(kind?: string): MemoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, text, tags, created_at AS createdAt, updated_at AS updatedAt, stale
         FROM memories ${kind ? 'WHERE kind = ?' : ''} ORDER BY created_at, rowid`,
      )
      .all(...(kind ? [kind] : [])) as (Omit<MemoryRow, 'tags' | 'stale' | 'links'> & {
      tags: string;
      stale: number;
    })[];
    const links = this.db
      .prepare(
        'SELECT memory_id AS id, file_path AS path, symbol_qualified_name AS symbol, content_hash_at_link AS contentHash FROM memory_links ORDER BY rowid',
      )
      .all() as (MemoryLink & { id: string })[];
    return rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags) as string[],
      stale: row.stale === 1,
      links: links
        .filter((l) => l.id === row.id)
        .map(({ path, symbol, contentHash }) => ({ path, symbol, contentHash })),
    }));
  }

  setMemoryStale(id: string, stale: boolean): void {
    this.db.prepare('UPDATE memories SET stale = ? WHERE id = ?').run(stale ? 1 : 0, id);
  }

  /** Memory ids by BM25 keyword match, best first. */
  memoryKeywordSearch(match: string, limit: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT m.id FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
         WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT ?`,
      )
      .all(match, limit) as { id: string }[];
    return rows.map((row) => row.id);
  }

  /** The stored vector of every memory; null when it has none from `modelId`. */
  memoryEmbeddings(
    modelId: string,
  ): { id: string; text: string; embedding: Float32Array | null }[] {
    const rows = this.db
      .prepare('SELECT id, text, embedding, embedding_model AS model FROM memories')
      .all() as { id: string; text: string; embedding: Buffer | null; model: string | null }[];
    return rows.map(({ id, text, embedding, model }) => ({
      id,
      text,
      embedding:
        embedding && model === modelId
          ? new Float32Array(
              embedding.buffer.slice(
                embedding.byteOffset,
                embedding.byteOffset + embedding.byteLength,
              ),
            )
          : null,
    }));
  }

  setMemoryEmbedding(id: string, modelId: string, embedding: Float32Array): void {
    this.db
      .prepare('UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?')
      .run(Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength), modelId, id);
  }

  /** The symbol with this qualified name in this file. */
  symbolAt(path: string, qualifiedName: string): SymbolRow | undefined {
    return this.db
      .prepare(
        `${SYMBOL_ROW} WHERE f.path = ? AND s.qualified_name = ? ORDER BY s.start_line LIMIT 1`,
      )
      .get(path, qualifiedName) as SymbolRow | undefined;
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

  /**
   * Chunks that have no vector yet, shortest first so batches pad less. `docLines` is how
   * many leading lines of `content` are the doc comment above the symbol.
   */
  chunksWithoutVectors(): EmbeddingInput[] {
    const missing = this.hasVectors()
      ? 'LEFT JOIN chunk_vectors v ON v.chunk_id = c.id WHERE v.chunk_id IS NULL'
      : '';
    return this.db
      .prepare(
        `SELECT c.id, f.path, c.content, COALESCE(s.signature, '') AS signature,
                COALESCE(s.docstring, '') AS docstring,
                MAX(0, COALESCE(s.start_line - c.start_line, 0)) AS docLines
         FROM chunks c JOIN files f ON f.id = c.file_id LEFT JOIN symbols s ON s.id = c.symbol_id
         ${missing} ORDER BY length(c.content)`,
      )
      .all() as EmbeddingInput[];
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

  /**
   * Removes cached vectors of other models, and, when `keep` is given, every cached vector
   * whose text hash is not in it. Returns how many rows were removed.
   */
  pruneEmbeddingCache(modelId: string, keep?: Set<string>): number {
    let removed = this.db
      .prepare('DELETE FROM embedding_cache WHERE model_id <> ?')
      .run(modelId).changes;
    if (keep) {
      this.transaction(() => {
        this.db.exec('CREATE TEMP TABLE IF NOT EXISTS keep_hashes (text_hash TEXT PRIMARY KEY)');
        this.db.exec('DELETE FROM keep_hashes');
        const insert = this.db.prepare('INSERT OR IGNORE INTO keep_hashes (text_hash) VALUES (?)');
        for (const hash of keep) insert.run(hash);
        removed += this.db
          .prepare(
            'DELETE FROM embedding_cache WHERE text_hash NOT IN (SELECT text_hash FROM keep_hashes)',
          )
          .run().changes;
      });
    }
    return removed;
  }

  /** How many vectors the embedding cache holds. */
  embeddingCacheSize(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM embedding_cache').get() as { n: number }).n;
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
