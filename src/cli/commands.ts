import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR, loadConfig } from '../config/index.js';
import { StoreError } from '../errors.js';
import { indexRepo } from '../indexer/index.js';
import { search } from '../retriever/index.js';
import { Store } from '../store/index.js';

const dbPath = (root: string): string => join(root, CONFIG_DIR, 'index.db');

/** `codemem index`: returns the summary line. */
export async function runIndex(root: string, options: { full?: boolean }): Promise<string> {
  const config = loadConfig(root);
  mkdirSync(join(root, CONFIG_DIR), { recursive: true });
  const store = new Store(dbPath(root));
  try {
    const stats = await indexRepo(root, store, config, options);
    const total = store.counts();
    return (
      `Indexed ${stats.indexed} of ${stats.scanned} files ` +
      `(${stats.unchanged} unchanged, ${stats.deleted} removed) in ${stats.seconds.toFixed(2)}s. ` +
      `Index: ${total.files} files, ${total.symbols} symbols, ${total.chunks} chunks.`
    );
  } finally {
    store.close();
  }
}

/** `codemem search`: returns the ranked results as text. */
export function runSearch(
  root: string,
  query: string,
  options: { k?: number; debug?: boolean },
): string {
  if (!existsSync(dbPath(root))) {
    throw new StoreError('No index found in this directory; run `codemem index` first');
  }
  const store = new Store(dbPath(root));
  try {
    const results = search(store, query, options.k ? { k: options.k } : {});
    if (results.length === 0) return 'No results.';
    return results
      .map(({ chunk, score, reasons }, i) => {
        const label = chunk.symbol ? `${chunk.kind} ${chunk.symbol}` : chunk.kind;
        const debug = options.debug ? `  score=${score.toFixed(3)}` : '';
        const head = `${i + 1}. ${chunk.path}:${chunk.startLine}-${chunk.endLine}  ${label}  [${reasons.join(', ')}]${debug}`;
        const detail = chunk.signature || (chunk.content.split('\n')[0] ?? '');
        return `${head}\n   ${detail.replaceAll('\n', '\n   ')}`;
      })
      .join('\n');
  } finally {
    store.close();
  }
}
