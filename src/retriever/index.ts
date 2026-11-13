import type { Config } from '../config/index.js';
import { EmbeddingError, modelChanged, type EmbeddingProvider } from '../embedder/index.js';
import type { ChunkRow, Store } from '../store/index.js';
import { expandTerms } from '../store/fts.js';

export type RetrievalConfig = Config['retrieval'];

export interface SearchResult {
  chunk: ChunkRow;
  score: number;
  /** Why the chunk was returned: `exact-symbol`, `keyword`, `vector`. */
  reasons: string[];
  /** 1-based rank in each source list, for `--debug`. */
  ranks: { keyword?: number; vector?: number };
}

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

/**
 * Reciprocal rank fusion: each list adds 1 / (k + rank) to the items it contains, so an item
 * ranked well by several lists beats one ranked first by a single list.
 */
export function fuse(lists: number[][], k: number): Map<number, number> {
  const scores = new Map<number, number>();
  for (const list of lists) {
    for (const [index, id] of list.entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    }
  }
  return scores;
}

/**
 * Hybrid search: keyword (BM25) and vector results fused by rank, with exact symbol-name
 * matches on top. Without a provider the search is keyword-only.
 */
export async function search(
  store: Store,
  query: string,
  config: RetrievalConfig,
  provider: EmbeddingProvider | null,
  k: number = config.defaultK,
): Promise<SearchResult[]> {
  const match = ftsQuery(query);
  const keyword = match
    ? store.keywordSearch(match, config.keywordLimit, config.keywordWeights).map((hit) => hit.id)
    : [];

  let vector: number[] = [];
  if (provider && query.trim() && store.embeddingModel() !== undefined) {
    if (modelChanged(store, provider)) {
      throw new EmbeddingError(
        `The index holds vectors from ${store.embeddingModel()} but the configured model is ${provider.id}; run \`codemem index --full\` to rebuild them`,
      );
    }
    const [embedding] = await provider.embed([query], 'query');
    if (embedding) vector = store.vectorSearch(embedding, config.vectorLimit).map((hit) => hit.id);
  }

  const scores = fuse([keyword, vector], config.rrfK);
  // An exact symbol name in the query outranks anything fusion can produce (at most 2 / k).
  const exact = new Set(store.chunkIdsForSymbols(symbolCandidates(query)));
  for (const id of exact) scores.set(id, 1 + (scores.get(id) ?? 0));

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  const chunks = new Map(store.getChunks(ranked.map(([id]) => id)).map((c) => [c.id, c]));
  return ranked.flatMap(([id, score]) => {
    const chunk = chunks.get(id);
    if (!chunk) return [];
    const keywordRank = keyword.indexOf(id) + 1;
    const vectorRank = vector.indexOf(id) + 1;
    return [
      {
        chunk,
        score,
        reasons: [
          ...(exact.has(id) ? ['exact-symbol'] : []),
          ...(keywordRank ? ['keyword'] : []),
          ...(vectorRank ? ['vector'] : []),
        ],
        ranks: {
          ...(keywordRank ? { keyword: keywordRank } : {}),
          ...(vectorRank ? { vector: vectorRank } : {}),
        },
      },
    ];
  });
}
