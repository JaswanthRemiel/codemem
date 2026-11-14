import { relative, sep } from 'node:path';
import { watch } from 'chokidar';
import type { Config } from '../config/index.js';
import type { EmbeddingProvider } from '../embedder/index.js';
import { log } from '../log.js';
import { isExcludedPath } from '../scanner/index.js';
import type { Store } from '../store/index.js';
import { indexRepo, type IndexStats } from './index.js';

/**
 * Keeps the index fresh while files change: after `watch.debounceMs` without further
 * changes, a quick re-index runs. `onRun` is called after each run that changed something.
 */
export function startWatch(
  root: string,
  store: Store,
  config: Config,
  provider: EmbeddingProvider | null,
  onRun: (stats: IndexStats) => void,
): { close: () => Promise<void> } {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;

  const run = async (): Promise<void> => {
    if (running) {
      again = true; // changes arrived mid-run: go once more when it finishes
      return;
    }
    running = true;
    try {
      const stats = await indexRepo(root, store, config, { quick: true, provider });
      if (stats.indexed > 0 || stats.deleted > 0) onRun(stats);
    } catch (error) {
      log.error(`re-index failed: ${String(error)}`);
    } finally {
      running = false;
      if (again) {
        again = false;
        void run();
      }
    }
  };

  const watcher = watch(root, {
    ignoreInitial: true,
    // Skip vendored and generated directories; the dummy name makes every segment count as one.
    ignored: (path) => {
      const rel = relative(root, path).split(sep).join('/');
      return rel !== '' && isExcludedPath(`${rel}/_`);
    },
  });
  watcher.on('all', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), config.watch.debounceMs);
  });
  watcher.on('error', (error) => log.error(`watcher error: ${String(error)}`));

  return {
    close: async () => {
      clearTimeout(timer);
      await watcher.close();
    },
  };
}
