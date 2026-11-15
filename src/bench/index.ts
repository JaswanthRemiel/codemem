import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, homedir, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, type Config } from '../config/index.js';
import { createProvider } from '../embedder/index.js';
import { CodememError } from '../errors.js';
import { indexRepo } from '../indexer/index.js';
import type { ToolContext } from '../mcp/tools.js';
import { scan } from '../scanner/index.js';
import { Store } from '../store/index.js';
import { countTokens } from '../tokens.js';
import { evaluateQuery, grepBaseline, type FileText, type StrategyResult } from './evaluate.js';
import { mineTasks, type BenchMemory, type BenchRepo, type BenchTask } from './mine.js';

export class BenchError extends CodememError {}

type Retrieval = Config['retrieval'];

export interface Strategy {
  name: string;
  /** `search_code` looks at `defaultK` results, `get_context` at `contextK`. */
  tool: 'search_code' | 'get_context';
  budget: number;
  retrieval?: Partial<Retrieval>;
  memories?: boolean;
}

export const BUDGETS = [2000, 4000, 8000];
/** The budget at which ablations and the README headline are measured. */
export const MAIN_BUDGET = 4000;
export const MAIN_STRATEGY = `get_context@${MAIN_BUDGET}`;

const context = (name: string, extra: Partial<Strategy> = {}): Strategy => ({
  name,
  tool: 'get_context',
  budget: MAIN_BUDGET,
  ...extra,
});

/** Edge weights with one confidence switched off. */
const without = (defaults: Retrieval, key: keyof Retrieval['edgeWeights']): Partial<Retrieval> => ({
  edgeWeights: { ...defaults.edgeWeights, [key]: 0 },
});

export function strategies(defaults: Retrieval): Strategy[] {
  return [
    ...BUDGETS.map((budget): Strategy => ({
      name: `search_code@${budget}`,
      tool: 'search_code',
      budget,
    })),
    ...BUDGETS.map((budget): Strategy => ({
      name: `get_context@${budget}`,
      tool: 'get_context',
      budget,
    })),
    context('ablation: keyword only', { retrieval: { vectorLimit: 0 } }),
    context('ablation: vector only', { retrieval: { keywordLimit: 0 } }),
    context('ablation: no graph expansion', { retrieval: { graphTopN: 0 } }),
    context('ablation: no signature compression', { retrieval: { compressNeighbors: false } }),
    // Whichever way the default goes, the pair shows what name-match edges change.
    defaults.edgeWeights['name-match'] === 0
      ? context('ablation: with name-match edges', {
          retrieval: { edgeWeights: { ...defaults.edgeWeights, 'name-match': 0.2 } },
        })
      : context('ablation: no name-match edges', { retrieval: without(defaults, 'name-match') }),
    context('ablation: with memories', { memories: true }),
  ];
}

/**
 * Extra configurations tried on the training split only, to choose defaults: each setting
 * is varied on its own around the current defaults, plus a grid of the memory thresholds.
 */
export function tuningStrategies(defaults: Retrieval): Strategy[] {
  const vary = <K extends keyof Retrieval>(key: K, values: Retrieval[K][]): Strategy[] =>
    values
      .filter((value) => value !== defaults[key])
      .map((value) => context(`tune: ${key}=${String(value)}`, { retrieval: { [key]: value } }));
  const out: Strategy[] = [
    ...vary('rrfK', [20, 60, 120]),
    ...vary('maxChunksPerFile', [0, 2, 3, 5]),
    ...vary('textFileWeight', [1, 0.5, 0.25, 0.1]),
    ...vary('neighborBudgetShare', [0, 0.1, 0.2, 0.3]),
    ...vary('contextK', [10, 20, 40]),
    ...[2, 5, 10]
      .filter((symbol) => symbol !== defaults.keywordWeights.symbol)
      .map((symbol) =>
        context(`tune: symbolWeight=${symbol}`, {
          retrieval: { keywordWeights: { ...defaults.keywordWeights, symbol } },
        }),
      ),
  ];
  for (const memoryMinKeywordMatch of [0.3, 0.5, 0.7]) {
    for (const memoryMinSimilarity of [0.2, 0.3, 0.4, 0.5]) {
      out.push(
        context(
          `tune: memory keyword>=${memoryMinKeywordMatch} similarity>=${memoryMinSimilarity}`,
          {
            memories: true,
            retrieval: { memoryMinKeywordMatch, memoryMinSimilarity },
          },
        ),
      );
    }
  }
  return out;
}

export interface TaskResult {
  id: string;
  repo: string;
  split: 'train' | 'test';
  /** First line of the task text. */
  title: string;
  files: string[];
  strategies: Record<string, StrategyResult>;
}

export interface BenchResults {
  date: string;
  /** Commit of codemem that produced the results. */
  gitSha: string;
  machine: { cpu: string; cores: number; memoryGb: number; os: string; node: string };
  embeddingModel: string;
  retrieval: Retrieval;
  repos: {
    name: string;
    url: string;
    commit: string;
    license: string;
    language: string;
    files: number;
    lines: number;
    chunks: number;
    /** Seconds for the first full index, embeddings included (0 when it was already cached). */
    indexSeconds: number;
    tasks: number;
  }[];
  /** A 20-file change re-indexed on the largest repo. */
  reindex?: { repo: string; files: number; seconds: number };
  tasks: TaskResult[];
}

export interface BenchOptions {
  /** Repo names to run; default all. */
  repos?: string[];
  /** Run only the first `limit` tasks of each repo. */
  limit?: number;
  /** Embedding model; default the configured default. */
  model?: string;
  /** Also run the tuning configurations on the training split. */
  tune?: boolean;
  log?: (line: string) => void;
}

/** The `bench/` data directory of a source checkout. */
export function benchDir(): string {
  const dir = fileURLToPath(new URL('../../bench/', import.meta.url));
  if (!existsSync(join(dir, 'repos.json'))) {
    throw new BenchError(
      'The benchmark runs from a source checkout of codemem: bench/repos.json was not found.',
    );
  }
  return dir;
}

/** Where benchmark clones and indexes are kept. Override with CODEMEM_CACHE_DIR. */
export function benchCacheDir(): string {
  return join(process.env['CODEMEM_CACHE_DIR'] ?? join(homedir(), '.cache', 'codemem'), 'bench');
}

export const readRepos = (): BenchRepo[] =>
  JSON.parse(readFileSync(join(benchDir(), 'repos.json'), 'utf8')) as BenchRepo[];

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

const git = (dir: string, args: string[]): string =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Clones the repo into the cache if needed and makes sure the pinned commit is there. */
export function ensureClone(repo: BenchRepo, log: (line: string) => void): string {
  const dir = join(benchCacheDir(), repo.name);
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(benchCacheDir(), { recursive: true });
    log(`Cloning ${repo.url}`);
    execFileSync('git', ['clone', '--quiet', repo.url, dir], { stdio: 'ignore' });
  }
  try {
    git(dir, ['cat-file', '-e', `${repo.commit}^{commit}`]);
  } catch {
    git(dir, ['fetch', '--quiet', 'origin']);
  }
  return dir;
}

/** `codemem bench --mine`: writes bench/tasks and bench/memories from each repo's history. */
export async function mine(log: (line: string) => void): Promise<void> {
  for (const repo of readRepos()) {
    const dir = ensureClone(repo, log);
    const { tasks, memories } = await mineTasks(dir, repo);
    const lines = (rows: object[]): string =>
      rows.map((row) => `${JSON.stringify(row)}\n`).join('');
    writeFileSync(join(benchDir(), 'tasks', `${repo.name}.jsonl`), lines(tasks));
    writeFileSync(join(benchDir(), 'memories', `${repo.name}.jsonl`), lines(memories));
    log(`${repo.name}: ${tasks.length} tasks, ${memories.length} memories`);
  }
}

function codememSha(): string {
  const root = join(benchDir(), '..');
  try {
    const sha = git(root, ['rev-parse', '--short', 'HEAD']).trim();
    return git(root, ['status', '--porcelain']).trim() ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

const tokenCache = new Map<string, number>();
function readFiles(dir: string): FileText[] {
  return scan(dir).map(({ path }) => {
    const content = readFileSync(join(dir, path), 'utf8');
    const key = createHash('sha1').update(content).digest('hex');
    let tokens = tokenCache.get(key);
    if (tokens === undefined) {
      tokens = countTokens(content);
      tokenCache.set(key, tokens);
    }
    return { path, content, tokens };
  });
}

/** Times a quick re-index after appending a line to 20 source files, then restores them. */
async function measureReindex(dir: string, ctx: ToolContext): Promise<number> {
  const targets = scan(dir)
    .map((file) => file.path)
    .filter((path) => /\.(ts|py|go)$/.test(path))
    .slice(0, 20);
  try {
    for (const path of targets) appendFileSync(join(dir, path), '\n// codemem benchmark probe\n');
    const started = performance.now();
    await indexRepo(dir, ctx.store, ctx.config, { quick: true, provider: ctx.provider });
    return (performance.now() - started) / 1000;
  } finally {
    git(dir, ['checkout', '--quiet', '--', ...targets]);
    await indexRepo(dir, ctx.store, ctx.config, { quick: true, provider: ctx.provider });
  }
}

/** Runs every strategy on every task and returns the raw results. */
export async function runBench(options: BenchOptions = {}): Promise<BenchResults> {
  const log = options.log ?? (() => undefined);
  const config = parseConfig(options.model ? { embedding: { model: options.model } } : {});
  const provider = createProvider(config.embedding);
  const repos = readRepos().filter((r) => !options.repos || options.repos.includes(r.name));
  const cpu = cpus();
  const results: BenchResults = {
    date: new Date().toISOString().slice(0, 10),
    gitSha: codememSha(),
    machine: {
      cpu: cpu[0]?.model ?? 'unknown',
      cores: cpu.length,
      memoryGb: Math.round(totalmem() / 2 ** 30),
      os: `${platform()} ${release()}`,
      node: process.version,
    },
    embeddingModel: provider?.id ?? 'none',
    retrieval: config.retrieval,
    repos: [],
    tasks: [],
  };

  let largest: { repo: BenchRepo; dir: string; ctx: ToolContext; lines: number } | undefined;
  for (const repo of repos) {
    const dir = ensureClone(repo, log);
    const tasks = readJsonl<BenchTask>(join(benchDir(), 'tasks', `${repo.name}.jsonl`)).slice(
      0,
      options.limit,
    );
    const memories = readJsonl<BenchMemory>(join(benchDir(), 'memories', `${repo.name}.jsonl`));
    if (tasks.length === 0)
      throw new BenchError(`No tasks for ${repo.name}; run \`codemem bench --mine\`.`);
    const slug = (provider?.id ?? 'none').replace(/[^a-z0-9]+/gi, '-');
    const store = new Store(join(benchCacheDir(), `${repo.name}-${slug}.db`));
    try {
      // Memories carry no links: in the ablation they must match the task on their own.
      store.transaction(() => {
        for (const m of memories) {
          store.putMemory({
            id: m.id,
            kind: 'decision',
            text: m.text,
            tags: [],
            createdAt: '2000-01-01T00:00:00.000Z',
            updatedAt: '2000-01-01T00:00:00.000Z',
            links: [],
          });
        }
      });
      const ctx: ToolContext = { root: dir, config, store, provider };
      let indexSeconds = 0;
      let files: FileText[] = [];
      for (const [i, task] of tasks.entries()) {
        git(dir, ['checkout', '--quiet', '--force', '--detach', task.parent]);
        const run = await indexRepo(dir, store, config, { provider });
        if (i === 0) {
          indexSeconds = run.indexed > 0 ? run.seconds : 0;
          // Load the model before anything is timed.
          await evaluateQuery(ctx, task, { k: 1, budget: 500 });
        }
        files = readFiles(dir);
        const scored: Record<string, StrategyResult> = { baseline: grepBaseline(files, task) };
        const all = [
          ...strategies(config.retrieval),
          ...(options.tune && task.split === 'train' ? tuningStrategies(config.retrieval) : []),
        ];
        for (const strategy of all) {
          const retrieval = { ...config.retrieval, ...strategy.retrieval };
          scored[strategy.name] = await evaluateQuery(
            { ...ctx, config: { ...config, retrieval } },
            task,
            {
              k: strategy.tool === 'get_context' ? retrieval.contextK : retrieval.defaultK,
              budget: strategy.budget,
              ...(strategy.memories ? { memories: true } : {}),
            },
            memories,
          );
        }
        results.tasks.push({
          id: task.id,
          repo: repo.name,
          split: task.split,
          title: task.text.split('\n')[0] ?? '',
          files: task.files,
          strategies: scored,
        });
        log(`${repo.name} ${i + 1}/${tasks.length} ${task.id} (${task.split})`);
      }
      const lines = files.reduce((n, f) => n + f.content.split('\n').length, 0);
      results.repos.push({
        name: repo.name,
        url: repo.url,
        commit: repo.commit,
        license: repo.license,
        language: repo.language,
        files: files.length,
        lines,
        chunks: store.counts().chunks,
        indexSeconds: Number(indexSeconds.toFixed(1)),
        tasks: tasks.length,
      });
      if (!largest || lines > largest.lines) {
        if (largest) largest.ctx.store.close();
        largest = { repo, dir, ctx, lines };
      } else {
        store.close();
      }
    } catch (error) {
      store.close();
      throw error;
    }
  }
  if (largest) {
    try {
      const seconds = await measureReindex(largest.dir, largest.ctx);
      results.reindex = { repo: largest.repo.name, files: 20, seconds: Number(seconds.toFixed(2)) };
    } finally {
      largest.ctx.store.close();
    }
  }
  return results;
}
