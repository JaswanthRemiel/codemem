import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR, loadConfig } from '../config/index.js';
import { StoreError } from '../errors.js';
import { describeSymbol, findReferences } from '../graph/describe.js';
import { indexRepo, pendingChanges, type IndexStats } from '../indexer/index.js';
import { startWatch } from '../indexer/watch.js';
import { LANGS, parseSource } from '../parser/index.js';
import { createProvider } from '../embedder/index.js';
import { pack } from '../packer/index.js';
import { search } from '../retriever/index.js';
import { Store } from '../store/index.js';
import { runTool, TOOLS } from '../mcp/tools.js';
import { formatStats } from '../stats/index.js';

const dbPath = (root: string): string => join(root, CONFIG_DIR, 'index.db');

/** `remimem index`: returns the summary line. */
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
    return `${describeRun(stats)}${vectors} Index: ${total.files} files, ${total.symbols} symbols, ${total.chunks} chunks.`;
  } finally {
    store.close();
  }
}

/** `remimem search`: returns the packed results as text. */
export async function runSearch(
  root: string,
  query: string,
  options: { k?: number; budget?: number; debug?: boolean },
): Promise<string> {
  if (!existsSync(dbPath(root))) {
    throw new StoreError('No index found in this directory; run `remimem index` first');
  }
  const config = loadConfig(root);
  const store = new Store(dbPath(root));
  try {
    const provider = createProvider(config.embedding);
    // The same quick check the MCP server runs before a tool call: pick up changed files.
    await indexRepo(root, store, config, { quick: true, provider });
    const results = await search(store, query, config.retrieval, provider, options.k);
    const packed = pack(
      results,
      options.budget ?? config.retrieval.defaultBudgetTokens,
      '',
      config.retrieval.neighborBudgetShare,
    );
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

/** `remimem context`: what the `get_context` tool returns, for pasting into any chat. */
export async function runContext(
  root: string,
  task: string,
  options: { budget?: number },
): Promise<string> {
  const config = loadConfig(root);
  const getContext = TOOLS.find((tool) => tool.name === 'get_context');
  return withStore(root, async (store) => {
    const ctx = { root, config, store, provider: createProvider(config.embedding) };
    if (!getContext) return '';
    // Unlike the server, a command cannot finish a refresh in the background: wait for it.
    await indexRepo(root, store, config, { quick: true, provider: ctx.provider });
    return runTool(ctx, getContext, { task, budget_tokens: options.budget }, { refresh: false });
  });
}

/** `remimem memory list`, `add`, and `rm`: the memory tools from the command line. */
export async function runMemory(
  root: string,
  action: 'list' | 'add' | 'rm',
  args: Record<string, unknown>,
): Promise<string> {
  const config = loadConfig(root);
  const name = { list: 'recall', add: 'remember', rm: 'forget' }[action];
  const memoryTool = TOOLS.find((tool) => tool.name === name);
  mkdirSync(join(root, CONFIG_DIR), { recursive: true });
  const store = new Store(dbPath(root));
  try {
    const ctx = { root, config, store, provider: createProvider(config.embedding) };
    return memoryTool ? await runTool(ctx, memoryTool, args, { refresh: false }) : '';
  } finally {
    store.close();
  }
}

/** How an MCP client should start this copy of remimem. */
function serverCommand(): { command: string; args: string[] } {
  const cli = fileURLToPath(new URL('./index.js', import.meta.url));
  // An installed package is started through npx; a source checkout by its path.
  return cli.includes('node_modules')
    ? { command: 'npx', args: ['-y', 'remimem', 'serve'] }
    : { command: 'node', args: [cli, 'serve'] };
}

/** Copy-paste MCP configuration for the supported clients. */
export function clientConfigs(): string {
  const { command, args } = serverCommand();
  const json = (server: object): string =>
    JSON.stringify({ mcpServers: { remimem: server } }, null, 2);
  const shell = [command, ...args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
  return [
    'Connect an MCP client (run it from this directory, or add "--root", "<path>" to the args):',
    '',
    'Claude Code, either run:',
    `  claude mcp add remimem -- ${shell}`,
    'or create .mcp.json in the project root:',
    json({ command, args }),
    '',
    'Cursor: create .cursor/mcp.json in the project root:',
    json({ command, args }),
    '',
    'VS Code (Copilot): create .mcp.json in the workspace root:',
    json({ type: 'stdio', command, args }),
    'Older VS Code versions read .vscode/mcp.json instead:',
    JSON.stringify({ servers: { remimem: { type: 'stdio', command, args } } }, null, 2),
  ].join('\n');
}

/** `remimem init`: config, .gitignore entry, first index, and client setup instructions. */
export async function runInit(
  root: string,
  options: { onEmbedProgress?: (done: number, total: number) => void },
): Promise<string> {
  const dir = join(root, CONFIG_DIR);
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'config.json');
  const steps: string[] = [];
  if (!existsSync(configPath)) {
    writeFileSync(configPath, '{}\n');
    steps.push(`Created ${CONFIG_DIR}/config.json (empty: every setting has a default).`);
  }
  // The index is a local cache; .remimem/memory.json and config.json stay committable.
  const ignorePath = join(root, '.gitignore');
  const entry = `${CONFIG_DIR}/index.db*`;
  const ignore = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : '';
  if (!ignore.split(/\r?\n/).includes(entry)) {
    appendFileSync(ignorePath, `${ignore && !ignore.endsWith('\n') ? '\n' : ''}${entry}\n`);
    steps.push(`Added ${entry} to .gitignore.`);
  }

  const provider = createProvider(loadConfig(root).embedding);
  const privacy =
    provider && !provider.local
      ? `Privacy: embeddings are computed by ${provider.id}, so indexed code is sent to that service.`
      : 'Privacy: everything runs on this machine. No code leaves it and there is no telemetry.';
  const summary = await runIndex(root, options);
  return [...steps, privacy, summary, '', clientConfigs()].join('\n');
}

function withStore<T>(root: string, run: (store: Store) => T): T {
  if (!existsSync(dbPath(root))) {
    throw new StoreError('No index found in this directory; run `remimem index` first');
  }
  const store = new Store(dbPath(root));
  let result: T;
  try {
    result = run(store);
  } catch (error) {
    store.close();
    throw error;
  }
  if (result instanceof Promise) return result.finally(() => store.close()) as T;
  store.close();
  return result;
}

/** One line describing an index run, shared by `index`, `init`, and `watch`. */
function describeRun(stats: IndexStats): string {
  return `Indexed ${stats.indexed} of ${stats.scanned} files (${stats.unchanged} unchanged, ${stats.deleted} removed) in ${stats.seconds.toFixed(2)}s.`;
}

/**
 * `remimem watch`: indexes once, then re-indexes whenever files change. Returns a function
 * that stops watching.
 */
export async function runWatch(
  root: string,
  print: (line: string) => void,
): Promise<() => Promise<void>> {
  const config = loadConfig(root);
  mkdirSync(join(root, CONFIG_DIR), { recursive: true });
  const store = new Store(dbPath(root));
  const provider = createProvider(config.embedding);
  print(describeRun(await indexRepo(root, store, config, { provider })));
  const watcher = startWatch(root, store, config, provider, (stats) => print(describeRun(stats)));
  print(`Watching ${root} for changes. Press Ctrl+C to stop.`);
  return async () => {
    await watcher.close();
    store.close();
  };
}

/** `remimem stats`: queries served and tokens served against the estimated baseline. */
export function runStats(root: string): string {
  return withStore(root, (store) => formatStats(store));
}

/** `remimem debug symbol`: a symbol with its neighbors. */
export function runSymbol(
  root: string,
  name: string,
  options: { depth?: number; include?: 'signature' | 'body' },
): string {
  return withStore(root, (store) => describeSymbol(store, name, options));
}

/** `remimem debug refs`: where a symbol is called, extended, used as a type, or imported. */
export function runRefs(root: string, name: string): string {
  return withStore(root, (store) => findReferences(store, name));
}

/** True when a Node.js version string such as "22.13.0" meets the minimum (22.13.0). */
export function nodeOk(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

/** `remimem doctor`: one line per check, and whether all of them passed. */
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
    await check(`Grammar ${lang}`, 'Reinstall remimem.', async () => {
      await parseSource(lang, '');
      return 'ok';
    });
  }
  await check('SQLite with FTS5 and sqlite-vec', 'Reinstall remimem.', async () => {
    new Store(':memory:').close();
    return 'ok';
  });
  await check(
    'Embedding model',
    'The first use downloads the model: check the network connection, or set "embedding": { "provider": "none" } in .remimem/config.json to work without it.',
    async () => {
      const provider = createProvider(loadConfig(root).embedding);
      if (!provider) return 'off (keyword search only)';
      const [vector] = await provider.embed(['remimem doctor'], 'query');
      return `${provider.id} ok (${vector?.length} dimensions)`;
    },
  );
  await check('Index', 'Run `remimem index --full` to rebuild it.', async () => {
    if (!existsSync(dbPath(root))) return 'none yet (run `remimem init` in the project)';
    const store = new Store(dbPath(root));
    try {
      const counts = store.counts();
      const pending = await pendingChanges(root, store, loadConfig(root));
      const model = store.embeddingModel();
      const missing = model ? counts.chunks - store.vectorCount() : 0;
      return [
        `${counts.files} files, ${counts.chunks} chunks`,
        `${pending.changed + pending.added + pending.deleted} pending changes`,
        model ? `${missing} chunks without a vector` : 'no vectors',
      ].join(', ');
    } finally {
      store.close();
    }
  });
  return { lines, ok };
}
