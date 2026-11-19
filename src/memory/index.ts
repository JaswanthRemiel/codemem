import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CONFIG_DIR } from '../config/index.js';
import type { EmbeddingProvider } from '../embedder/index.js';
import { RemimemError } from '../errors.js';
import { ftsQuery, fuse, queryTokens, type RetrievalConfig } from '../retriever/index.js';
import { expandTerms } from '../store/fts.js';
import type { MemoryLink, MemoryRow, Store } from '../store/index.js';

export class MemoryError extends RemimemError {}

export const MEMORY_KINDS = ['decision', 'convention', 'gotcha', 'todo'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type Memory = MemoryRow;

/** The committable mirror of the memory tables: `.remimem/memory.json`. */
const FileSchema = z.object({
  version: z.literal(1),
  memories: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(MEMORY_KINDS),
      text: z.string().min(1),
      tags: z.array(z.string()).default([]),
      createdAt: z.string(),
      updatedAt: z.string(),
      links: z
        .array(
          z.object({
            path: z.string(),
            symbol: z.string().nullable().default(null),
            contentHash: z.string(),
          }),
        )
        .default([]),
    }),
  ),
});

const mirrorPath = (root: string): string => join(root, CONFIG_DIR, 'memory.json');
const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Brings the database in line with `.remimem/memory.json` when the file has changed since
 * the last look: after a `git pull`, a hand edit, or a deleted index. The file is the
 * source of truth, so a team shares memories by committing it.
 */
export function syncMemories(root: string, store: Store): void {
  const path = mirrorPath(root);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  const hash = hashOf(text);
  if (store.getMeta('memory_json_hash') === hash) return;
  let parsed: z.infer<typeof FileSchema>;
  try {
    parsed = FileSchema.parse(JSON.parse(text));
  } catch (cause) {
    // Leave the database as it is rather than lose memories to a bad merge.
    throw new MemoryError(
      `${CONFIG_DIR}/memory.json is not valid (${cause instanceof z.ZodError ? z.prettifyError(cause) : String(cause)}). Fix the file, or restore it with git.`,
    );
  }
  store.transaction(() => {
    const keep = new Set(parsed.memories.map((m) => m.id));
    for (const existing of store.listMemories()) {
      if (!keep.has(existing.id)) store.deleteMemory(existing.id);
    }
    const current = new Map(store.listMemories().map((m) => [m.id, m]));
    for (const memory of parsed.memories) {
      const known = current.get(memory.id);
      // Untouched memories keep their stored vector.
      if (!known || JSON.stringify(toFile(known)) !== JSON.stringify(memory))
        store.putMemory(memory);
    }
    store.setMeta('memory_json_hash', hash);
  });
  refreshStaleness(store);
}

const toFile = (m: Memory): Omit<Memory, 'stale'> => ({
  id: m.id,
  kind: m.kind,
  text: m.text,
  tags: m.tags,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
  links: m.links,
});

function writeMirror(root: string, store: Store): void {
  // Sorted by id with one memory per line: two people adding memories touch different
  // lines, so git can merge the file without conflicts in most cases.
  const lines = store
    .listMemories()
    .map(toFile)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((memory) => `    ${JSON.stringify(memory)}`);
  const text = `{\n  "version": 1,\n  "memories": [\n${lines.join(',\n')}\n  ]\n}\n`;
  mkdirSync(join(root, CONFIG_DIR), { recursive: true });
  // Write then rename, so a crash cannot leave half a file.
  const temp = `${mirrorPath(root)}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, mirrorPath(root));
  store.setMeta('memory_json_hash', hashOf(text));
}

/** The hash of what a link points at now, or null when the file or symbol is gone. */
function currentHash(
  store: Store,
  files: Map<string, string>,
  link: Omit<MemoryLink, 'contentHash'>,
): string | null {
  if (link.symbol === null) return files.get(link.path) ?? null;
  const symbol = store.symbolAt(link.path, link.symbol);
  if (!symbol) return null;
  return hashOf(
    store
      .chunksOfSymbol(symbol.id)
      .map((chunk) => chunk.content)
      .join('\n'),
  );
}

/**
 * Marks a memory stale when any code it is linked to has changed or disappeared since the
 * link was made. Run after every index. Returns how many memories are stale.
 */
export function refreshStaleness(store: Store): number {
  const files = store.fileHashes();
  let staleCount = 0;
  store.transaction(() => {
    for (const memory of store.listMemories()) {
      const stale = memory.links.some(
        (link) => currentHash(store, files, link) !== link.contentHash,
      );
      if (stale) staleCount++;
      if (stale !== memory.stale) store.setMemoryStale(memory.id, stale);
    }
  });
  return staleCount;
}

export interface RememberInput {
  text: string;
  kind: MemoryKind;
  paths?: string[] | undefined;
  symbols?: string[] | undefined;
  tags?: string[] | undefined;
  /** Replaces this existing memory instead of adding one; its creation time is kept. */
  id?: string | undefined;
}

/** Stores a memory and links it to code. Names that cannot be linked are reported back. */
export function remember(
  root: string,
  store: Store,
  input: RememberInput,
): { memory: Memory; unlinked: string[] } {
  syncMemories(root, store);
  const files = store.fileHashes();
  const links: MemoryLink[] = [];
  const unlinked: string[] = [];
  for (const raw of input.paths ?? []) {
    const path = raw.replaceAll('\\', '/').replace(/^\.\//, '');
    const contentHash = files.get(path);
    if (contentHash) links.push({ path, symbol: null, contentHash });
    else unlinked.push(`${raw} (no such file in the index)`);
  }
  for (const name of input.symbols ?? []) {
    const matches = store.symbolsNamed(name);
    const exact = matches.filter((s) => s.qualifiedName === name);
    const candidates = exact.length > 0 ? exact : matches;
    const symbol = candidates[0];
    if (!symbol || candidates.length > 1) {
      unlinked.push(
        `${name} (${symbol ? `${candidates.length} symbols have this name; use a qualified name` : 'no such symbol in the index'})`,
      );
      continue;
    }
    const link = { path: symbol.path, symbol: symbol.qualifiedName };
    links.push({ ...link, contentHash: currentHash(store, files, link) ?? '' });
  }

  const now = new Date().toISOString();
  const existing =
    input.id === undefined ? undefined : store.listMemories().find((m) => m.id === input.id);
  if (input.id !== undefined && !existing) throw new MemoryError(`No memory with id ${input.id}.`);
  const memory: Omit<Memory, 'stale'> = {
    id: existing?.id ?? `m_${randomBytes(4).toString('hex')}`,
    kind: input.kind,
    text: input.text.trim(),
    tags: [...new Set(input.tags ?? [])],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    links,
  };
  if (!memory.text) throw new MemoryError('A memory needs some text.');
  store.transaction(() => store.putMemory(memory));
  writeMirror(root, store);
  return { memory: { ...memory, stale: false }, unlinked };
}

/** Deletes a memory. Returns false when there is none with that id. */
export function forget(root: string, store: Store, id: string): boolean {
  syncMemories(root, store);
  const removed = store.transaction(() => store.deleteMemory(id));
  if (removed) writeMirror(root, store);
  return removed;
}

export interface RecallOptions {
  kind?: string | undefined;
  limit?: number;
}

/** The minimum relevance a memory needs to count as a match. */
export type MemoryThresholds = Pick<
  RetrievalConfig,
  'memoryMinSimilarity' | 'memoryMinKeywordMatch'
>;

/** The share of the query's terms that occur in a memory, with the same prefix rule as search. */
function keywordMatch(terms: string[], memory: Memory): number {
  if (terms.length === 0) return 0;
  const words = [...new Set(expandTerms(`${memory.text} ${memory.tags.join(' ')}`))];
  const found = terms.filter((term) =>
    words.some((word) => (term.length >= 3 ? word.startsWith(term) : word === term)),
  );
  return found.length / terms.length;
}

/**
 * Memories matching a query, best first: keyword and vector ranks fused the same way as
 * code search. A memory must clear a minimum on at least one side: enough of the query's
 * terms, or enough vector similarity. One shared word is not a match. An empty query
 * lists everything.
 */
export async function recall(
  root: string,
  store: Store,
  provider: EmbeddingProvider | null,
  query: string,
  thresholds: MemoryThresholds,
  options: RecallOptions = {},
): Promise<Memory[]> {
  syncMemories(root, store);
  const all = store.listMemories(options.kind);
  const limit = options.limit ?? 10;
  if (!query.trim()) return all.slice(0, limit);
  const byId = new Map(all.map((m) => [m.id, m]));

  const terms = [...new Set(queryTokens(query).flatMap((token) => expandTerms(token)))];
  const match = ftsQuery(query);
  const keyword = (match ? store.memoryKeywordSearch(match, 50) : []).filter((id) => {
    const memory = byId.get(id);
    return memory && keywordMatch(terms, memory) >= thresholds.memoryMinKeywordMatch;
  });
  let vector: string[] = [];
  if (provider && all.length > 0) {
    const stored = store.memoryEmbeddings(provider.id);
    // Memories that arrived through memory.json have no vector yet.
    const missing = stored.filter((m) => !m.embedding);
    const fresh = await provider.embed(
      missing.map((m) => m.text),
      'document',
    );
    for (const [i, m] of missing.entries()) {
      m.embedding = fresh[i] ?? null;
      if (m.embedding) store.setMemoryEmbedding(m.id, provider.id, m.embedding);
    }
    const [target] = await provider.embed([query], 'query');
    if (target) {
      vector = stored
        .flatMap((m) => {
          if (!m.embedding) return [];
          let similarity = 0;
          for (let i = 0; i < target.length; i++)
            similarity += (target[i] ?? 0) * (m.embedding[i] ?? 0);
          return similarity >= thresholds.memoryMinSimilarity ? [{ id: m.id, similarity }] : [];
        })
        .sort((a, b) => b.similarity - a.similarity)
        .map((m) => m.id);
    }
  }

  // Ranks are positions in each list; `fuse` works on numbers, so map ids to indexes.
  const ids = [...new Set([...keyword, ...vector])];
  const index = new Map(ids.map((id, i) => [id, i]));
  const scores = fuse(
    [keyword, vector].map((list) => list.map((id) => index.get(id) as number)),
    60,
  );
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .flatMap(([i]) => byId.get(ids[i] as string) ?? [])
    .slice(0, limit);
}

/**
 * Memories that belong with a set of results whatever their wording: those linked to a
 * result's file as a whole, or to a symbol that is itself in the results. A memory linked
 * to some other symbol of the same file has to earn its place through `recall`.
 */
export function linkedMemories(
  store: Store,
  results: { path: string; symbol: string | null }[],
): Memory[] {
  const paths = new Set(results.map((r) => r.path));
  const symbols = new Set(results.map((r) => `${r.path} ${r.symbol}`));
  return store
    .listMemories()
    .filter((memory) =>
      memory.links.some((link) =>
        link.symbol === null ? paths.has(link.path) : symbols.has(`${link.path} ${link.symbol}`),
      ),
    );
}

/** One memory as text for an agent: kind, id, staleness, text, links, and tags. */
export function formatMemory(memory: Memory): string {
  const stale = memory.stale ? ' STALE: linked code has changed since this was written' : '';
  const links = memory.links.map((l) => (l.symbol ? `${l.path} ${l.symbol}` : l.path));
  const details = [
    ...(links.length > 0 ? [`linked: ${links.join(', ')}`] : []),
    ...(memory.tags.length > 0 ? [`tags: ${memory.tags.join(', ')}`] : []),
  ];
  return `[${memory.kind}] ${memory.id}${stale}\n  ${memory.text.replaceAll('\n', '\n  ')}${details.length > 0 ? `\n  (${details.join('; ')})` : ''}`;
}
