import type { Config } from '../config/index.js';
import { EmbeddingError, modelChanged, type EmbeddingProvider } from '../embedder/index.js';
import type { ChunkRow, Store } from '../store/index.js';
import { expandTerms } from '../store/fts.js';

export type RetrievalConfig = Config['retrieval'];

export interface SearchResult {
  chunk: ChunkRow;
  score: number;
  /** Why it was returned: `exact-symbol`, `keyword`, `vector`, `calls X`, `called by Y`, ... */
  reasons: string[];
  /** 1-based rank in each source list, for `--debug`. */
  ranks: { keyword?: number; vector?: number };
  /** Graph neighbors are shown as signature only. */
  detail: 'full' | 'signature';
}

/** How a neighbor relates to the result it was reached from, as a reason for the agent. */
const NEIGHBOR_REASONS: Record<string, string> = {
  calls: 'called by',
  'calls by': 'calls',
  extends: 'extended by',
  'extends by': 'extends',
  implements: 'implemented by',
  'implements by': 'implements',
  'uses-type': 'type used by',
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
  const keyword =
    match && config.keywordLimit > 0
      ? store.keywordSearch(match, config.keywordLimit, config.keywordWeights).map((hit) => hit.id)
      : [];

  let vector: number[] = [];
  if (provider && config.vectorLimit > 0 && query.trim() && store.embeddingModel() !== undefined) {
    if (modelChanged(store, provider)) {
      throw new EmbeddingError(
        `The index holds vectors from ${store.embeddingModel()} but the configured model is ${provider.id}; run \`remimem index --full\` to rebuild them`,
      );
    }
    const [embedding] = await provider.embed([query], 'query');
    if (embedding) vector = store.vectorSearch(embedding, config.vectorLimit).map((hit) => hit.id);
  }

  const scores = fuse([keyword, vector], config.rrfK);
  // An exact symbol name in the query outranks anything fusion can produce (at most 2 / k).
  // The exact-name lookup is a keyword signal, so it is off when keyword search is.
  const exact = new Set(
    config.keywordLimit > 0 ? store.chunkIdsForSymbols(symbolCandidates(query)) : [],
  );
  for (const id of exact) scores.set(id, 1 + (scores.get(id) ?? 0));

  // Chunks are loaded for every candidate (at most the two limits), so that text files can
  // be down-weighted and one file cannot take every slot.
  const chunks = new Map(store.getChunks([...scores.keys()]).map((c) => [c.id, c]));
  if (config.textFileWeight !== 1) {
    for (const [id, score] of scores) {
      if (chunks.get(id)?.language === null) scores.set(id, score * config.textFileWeight);
    }
  }
  const perFile = new Map<string, number>();
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([id]) => {
      if (config.maxChunksPerFile === 0) return true;
      const path = chunks.get(id)?.path ?? '';
      const count = (perFile.get(path) ?? 0) + 1;
      perFile.set(path, count);
      return count <= config.maxChunksPerFile;
    })
    .slice(0, k);
  const results = ranked.flatMap(([id, score]): SearchResult[] => {
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
        detail: 'full',
      },
    ];
  });
  return [...results, ...expand(store, results, config)];
}

/**
 * Graph expansion: the direct neighbors of the top results (callers, callees, base and
 * derived classes, referenced types, the enclosing class), scored as the result's score
 * times the weight of the edge's confidence. A neighbor that is already a result only
 * gains a reason.
 */
function expand(store: Store, results: SearchResult[], config: RetrievalConfig): SearchResult[] {
  const bySymbol = new Map<number, SearchResult>();
  for (const result of results) {
    const id = result.chunk.symbolId;
    if (id !== null && !bySymbol.has(id)) bySymbol.set(id, result);
  }
  const seeds = [...bySymbol.keys()].slice(0, config.graphTopN);
  const added = new Map<number, SearchResult>();
  for (const n of store.neighbors(seeds)) {
    const parent = bySymbol.get(n.of) as SearchResult;
    const relation =
      n.relation === 'inside' && n.kind === 'class' ? 'contains' : NEIGHBOR_REASONS[n.relation];
    if (!relation) continue;
    // A function nested in the result is already part of the result's text.
    const inside =
      n.path === parent.chunk.path &&
      n.startLine >= parent.chunk.startLine &&
      n.endLine <= parent.chunk.endLine;
    if (inside && n.relation !== 'inside') continue;
    const reason = `${relation} ${parent.chunk.symbol}`;
    const existing = bySymbol.get(n.id) ?? added.get(n.id);
    const weight = config.edgeWeights[n.confidence as keyof RetrievalConfig['edgeWeights']] ?? 0;
    if (weight === 0) continue;
    const score = parent.score * weight;
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      if (added.has(n.id)) existing.score = Math.max(existing.score, score);
      continue;
    }
    const body = config.compressNeighbors ? undefined : store.chunksOfSymbol(n.id)[0];
    added.set(n.id, {
      // Not a stored chunk: the neighbor's own signature, under a negative id.
      chunk: body ?? {
        id: -n.id,
        symbolId: n.id,
        path: n.path,
        language: null,
        startLine: n.startLine,
        endLine: n.endLine,
        content: n.signature,
        tokenCount: 0,
        symbol: n.qualifiedName,
        kind: n.kind,
        signature: n.signature,
        docstring: n.docstring,
      },
      score,
      reasons: [reason],
      ranks: {},
      detail: body ? 'full' : 'signature',
    });
  }
  return [...added.values()].sort((a, b) => b.score - a.score).slice(0, config.graphMaxNeighbors);
}
