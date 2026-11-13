import type { ChunkRow, KeywordWeights, Store } from '../store/index.js';
import { expandTerms } from '../store/fts.js';

export interface SearchResult {
  chunk: ChunkRow;
  score: number;
  /** Why the chunk was returned: `exact-symbol`, `keyword`. */
  reasons: string[];
}

export interface SearchOptions {
  /** Number of results to return. */
  k: number;
  /** Candidates taken from the keyword index before ranking. */
  keywordLimit: number;
  keywordWeights: KeywordWeights;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  k: 10,
  keywordLimit: 50,
  keywordWeights: { content: 1, symbol: 5, path: 2 },
};

/** Words that say nothing about code and would match almost every chunk. */
const STOPWORDS = new Set(
  'a an and are as at be by do does for from how in is it of on or that the this to what when where which with'.split(
    ' ',
  ),
);

/** Identifier-like tokens of a query, including dotted paths such as `UserService.login`. */
export function queryTokens(query: string): string[] {
  const tokens = query.match(/[\p{L}\p{N}_$]+(\.[\p{L}\p{N}_$]+)*/gu) ?? [];
  return [...new Set(tokens)].filter((token) => !STOPWORDS.has(token.toLowerCase()));
}

/**
 * The FTS5 query for a search: any term may match, and terms of three or more characters
 * also match as a prefix, so `auth` finds `authenticate`.
 */
export function ftsQuery(query: string): string {
  const terms = new Set(queryTokens(query).flatMap((token) => expandTerms(token)));
  return [...terms].map((term) => (term.length >= 3 ? `"${term}"*` : `"${term}"`)).join(' OR ');
}

/**
 * Names worth an exact symbol lookup: tokens shaped like identifiers (camelCase, snake_case,
 * dotted paths), plus the last segment of a dotted path. A plain word such as `resolve` only
 * counts when it is the whole query; otherwise ordinary words in a sentence would pull in
 * every symbol that happens to share their name.
 */
export function symbolCandidates(query: string): string[] {
  const tokens = queryTokens(query);
  const names = tokens.filter((t) => tokens.length === 1 || /[._$\p{N}]|\p{Ll}\p{Lu}/u.test(t));
  const lastSegments = names.filter((t) => t.includes('.')).map((t) => t.split('.').at(-1) ?? t);
  return [...new Set([...names, ...lastSegments])];
}

/** Keyword search with exact symbol-name matches ranked first. */
export function search(
  store: Store,
  query: string,
  options: Partial<SearchOptions> = {},
): SearchResult[] {
  const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };
  const scores = new Map<number, { score: number; reasons: string[] }>();

  const match = ftsQuery(query);
  const hits = match ? store.keywordSearch(match, opts.keywordLimit, opts.keywordWeights) : [];
  for (const { id, score } of hits) scores.set(id, { score, reasons: ['keyword'] });

  // An exact symbol name in the query outranks every keyword hit.
  const top = (hits[0]?.score ?? 0) + 1;
  for (const id of store.chunkIdsForSymbols(symbolCandidates(query))) {
    const existing = scores.get(id);
    scores.set(id, {
      score: top + (existing?.score ?? 0),
      reasons: ['exact-symbol', ...(existing?.reasons ?? [])],
    });
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, opts.k);
  const chunks = new Map(store.getChunks(ranked.map(([id]) => id)).map((c) => [c.id, c]));
  return ranked.flatMap(([id, { score, reasons }]) => {
    const chunk = chunks.get(id);
    return chunk ? [{ chunk, score, reasons }] : [];
  });
}
