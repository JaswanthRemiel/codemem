import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR, loadConfig } from '../config/index.js';
import { StoreError } from '../errors.js';
import { describeSymbol, findReferences } from '../graph/describe.js';
import { indexRepo } from '../indexer/index.js';
import { LANGS, parseSource } from '../parser/index.js';
import { createProvider } from '../embedder/index.js';
import { pack } from '../packer/index.js';
import { search } from '../retriever/index.js';
import { Store } from '../store/index.js';

const dbPath = (root: string): string => join(root, CONFIG_DIR, 'index.db');

/** `codemem index`: returns the summary line. */
export async function runIndex(
  root: string,
  options: { full?: boolean; onEmbedProgress?: (done: number, total: number) => void },
): Promise<string> {
  const config = loadConfig(root);
  mkdirSync(join(root, CONFIG_DIR), { recursive: true });
  const store = new Store(dbPath(root));
  try {
    const provider = createProvider(config.embedding);
    const stats = await indexRepo(root, store, config, { ...options, provider });
    const total = store.counts();
    const vectors = provider
      ? ` Embedded ${stats.embedded} chunks (${stats.embeddingsCached} from cache) with ${provider.id}.`
      : ' Embeddings are off.';
    return (
      `Indexed ${stats.indexed} of ${stats.scanned} files ` +
      `(${stats.unchanged} unchanged, ${stats.deleted} removed) in ${stats.seconds.toFixed(2)}s.` +
      `${vectors} Index: ${total.files} files, ${total.symbols} symbols, ${total.chunks} chunks.`
    );
  } finally {
    store.close();
  }
}

/** `codemem search`: returns the packed results as text. */
export async function runSearch(
  root: string,
  query: string,
  options: { k?: number; budget?: number; debug?: boolean },
): Promise<string> {
  if (!existsSync(dbPath(root))) {
    throw new StoreError('No index found in this directory; run `codemem index` first');
  }
  const config = loadConfig(root);
  const store = new Store(dbPath(root));
  try {
    const results = await search(
      store,
      query,
      config.retrieval,
      createProvider(config.embedding),
      options.k,
    );
    const packed = pack(results, options.budget ?? config.retrieval.defaultBudgetTokens);
    if (!options.debug) return packed.text;
    const scores = results.map(({ chunk, score, ranks }, i) => {
      const fit = packed.included.some((item) => item.chunk.id === chunk.id) ? '' : '  (dropped)';
      const ranksText = `keyword=${ranks.keyword ?? '-'} vector=${ranks.vector ?? '-'}`;
      return `${i + 1}. score=${score.toFixed(4)} ${ranksText}  ${chunk.path}:${chunk.startLine}-${chunk.endLine} ${chunk.symbol ?? 'lines'}${fit}`;
    });
    return `${scores.join('\n')}\n\n${packed.text}`;
  } finally {
    store.close();
  }
}

function withStore<T>(root: string, run: (store: Store) => T): T {
  if (!existsSync(dbPath(root))) {
    throw new StoreError('No index found in this directory; run `codemem index` first');
  }
  const store = new Store(dbPath(root));
  try {
    return run(store);
  } finally {
    store.close();
  }
}

/** `codemem debug symbol`: a symbol with its neighbors. */
export function runSymbol(
  root: string,
  name: string,
  options: { depth?: number; include?: 'signature' | 'body' },
): string {
  return withStore(root, (store) => describeSymbol(store, name, options));
}

/** `codemem debug refs`: where a symbol is called, extended, used as a type, or imported. */
export function runRefs(root: string, name: string): string {
  return withStore(root, (store) => findReferences(store, name));
}

/** True when a Node.js version string such as "22.13.0" meets the minimum (22.13.0). */
export function nodeOk(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

/** `codemem doctor`: one line per check, and whether all of them passed. */
export async function runDoctor(root: string): Promise<{ lines: string[]; ok: boolean }> {
  const lines: string[] = [];
  let ok = true;
  const check = async (name: string, fix: string, run: () => Promise<string>): Promise<void> => {
    try {
      lines.push(`${name}: ${await run()}`);
    } catch (error) {
      ok = false;
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      lines.push(`${name}: failed (${String(cause)}). ${fix}`);
    }
  };

  await check('Node.js', 'Install Node.js 22.13.0 or newer.', async () => {
    if (!nodeOk(process.versions.node)) throw new Error(`${process.versions.node} is too old`);
    return `${process.versions.node} ok`;
  });
  for (const lang of LANGS) {
    await check(`Grammar ${lang}`, 'Reinstall codemem.', async () => {
      await parseSource(lang, '');
      return 'ok';
    });
  }
  await check('SQLite with FTS5 and sqlite-vec', 'Reinstall codemem.', async () => {
    new Store(':memory:').close();
    return 'ok';
  });
  await check(
    'Embedding model',
    'The first use downloads the model: check the network connection, or set "embedding": { "provider": "none" } in .codemem/config.json to work without it.',
    async () => {
      const provider = createProvider(loadConfig(root).embedding);
      if (!provider) return 'off (keyword search only)';
      const [vector] = await provider.embed(['codemem doctor'], 'query');
      return `${provider.id} ok (${vector?.length} dimensions)`;
    },
  );
  lines.push('Not checked yet (added in a later phase): index health');
  return { lines, ok };
}
