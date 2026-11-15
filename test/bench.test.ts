import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { latestResults } from '../src/bench/command.js';
import {
  evaluateQuery,
  extractKeywords,
  grepBaseline,
  parseBlocks,
} from '../src/bench/evaluate.js';
import {
  benchDir,
  INSPECTED_TASKS,
  MAIN_STRATEGY,
  readRepos,
  strategies,
  tuningStrategies,
  type BenchResults,
  type TaskResult,
} from '../src/bench/index.js';
import {
  isSourceFile,
  mineTasks,
  oldRanges,
  plainText,
  type BenchTask,
} from '../src/bench/mine.js';
import {
  compareResults,
  README_END,
  README_START,
  renderSummary,
  renderTuning,
  summarize,
  updateReadme,
} from '../src/bench/report.js';
import type { StrategyResult } from '../src/bench/evaluate.js';
import { scan } from '../src/scanner/index.js';
import { countTokens } from '../src/tokens.js';
import { indexed, TEST_CONFIG } from './helpers.js';

const result = (over: Partial<StrategyResult> = {}): StrategyResult => ({
  fileRecall: 1,
  symbolRecall: 1,
  recallAt10: 1,
  strictFileRecall: 1,
  strictSymbolRecall: 1,
  firstHitTokens: 1000,
  tokens: 3000,
  reciprocalRank: 1,
  hitAt10: true,
  latencyMs: 20,
  ...over,
});

const taskResult = (
  id: string,
  split: 'train' | 'test',
  strategiesFor: Record<string, StrategyResult>,
): TaskResult => ({
  id,
  repo: 'demo',
  split,
  title: `fix: task ${id}`,
  files: ['src/a.ts'],
  strategies: strategiesFor,
});

function fakeResults(main: Partial<StrategyResult> = {}): BenchResults {
  const miss = result({
    fileRecall: 0,
    symbolRecall: 0,
    recallAt10: 0,
    strictFileRecall: 0,
    strictSymbolRecall: 0,
    firstHitTokens: null,
    reciprocalRank: 0,
    hitAt10: false,
  });
  return {
    date: '2026-11-15',
    gitSha: 'abc1234',
    machine: { cpu: 'Test CPU', cores: 8, memoryGb: 16, os: 'linux 6', node: 'v22.13.0' },
    embeddingModel: 'local:test-model',
    retrieval: TEST_CONFIG.retrieval,
    repos: [
      {
        name: 'demo',
        url: 'https://example.com/demo.git',
        commit: '0123456789abcdef',
        license: 'MIT',
        language: 'typescript',
        files: 10,
        lines: 1000,
        chunks: 50,
        indexSeconds: 2,
        tasks: 3,
      },
    ],
    reindex: { repo: 'demo', files: 20, seconds: 0.5 },
    tasks: [
      taskResult('t1', 'test', {
        baseline: result({ firstHitTokens: 20000, tokens: 30000 }),
        [MAIN_STRATEGY]: result(main),
        'ablation: with memories': result({ memory: { attached: 2, relevant: 1, available: 1 } }),
      }),
      taskResult('t2', 'test', {
        baseline: miss,
        [MAIN_STRATEGY]: result({
          fileRecall: 0.5,
          recallAt10: 0.5,
          strictFileRecall: 0,
          reciprocalRank: 0.5,
        }),
        'ablation: with memories': result({ memory: { attached: 2, relevant: 0, available: 0 } }),
      }),
      taskResult('t3', 'train', {
        baseline: result(),
        [MAIN_STRATEGY]: result(),
        'tune: rrfK=20': result({ fileRecall: 0.5 }),
      }),
    ],
  };
}

test('diff hunks, source files, and task text are read as the miner expects', () => {
  const diff = '@@ -10,3 +10,4 @@ fn\n-x\n@@ -40 +41,2 @@\n@@ -52,0 +55,2 @@\n';
  expect(oldRanges(diff)).toEqual([
    [10, 12],
    [40, 40],
    [52, 53],
  ]);
  for (const path of ['src/app.ts', 'pkg/server.go', 'httpx/_client.py'])
    expect(isSourceFile(path), path).toBe(true);
  for (const path of [
    'tests/test_api.py',
    'src/app.test.ts',
    'router_test.go',
    'docs/index.md',
    'README.md',
    'types/index.d.ts',
    'examples/demo.go',
  ]) {
    expect(isSourceFile(path), path).toBe(false);
  }
  const dash = String.fromCodePoint(0x2014);
  const emoji = String.fromCodePoint(0x1f680);
  expect(plainText(`fix${dash}now ${emoji} ships   \nnext`)).toBe('fix - now  ships\nnext');
});

test('tasks are mined from real commits: fixes and features that change existing source', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'remimem-mine-'));
  cpSync('test/fixtures/ts-app', dir, { recursive: true });
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
  const commit = (message: string): string => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };
  git('init', '-q');
  commit('initial import of the application');
  const edit = (path: string, from: string, to: string): void =>
    writeFileSync(join(dir, path), readFileSync(join(dir, path), 'utf8').replace(from, to));

  edit('src/hash.ts', 'total * 31', 'total * 37');
  const fix = commit(
    'fix(hash): use a larger multiplier so short passwords collide less\n\nSigned-off-by: Someone <s@example.com>',
  );
  edit('db/schema.sql', 'payload TEXT', 'payload BLOB');
  commit('fix(schema): store payloads as blobs instead of text');
  edit(
    'src/auth.ts',
    'if (!user) return false;',
    'if (!user) return false;\n  if (!password) return false;',
  );
  writeFileSync(join(dir, 'src/extra.ts'), 'export const extra = 1;\n');
  const feature = commit('feat(auth): reject empty passwords before comparing hashes');
  edit('src/db.ts', 'USERS.get(id)', 'USERS.get(id) ?? undefined');
  commit('chore: tidy the lookup helper in the database module');
  edit('src/db.ts', 'USERS.set(user.id, user)', 'USERS.set(user.id, { ...user })');
  commit('copy');
  const head = git('rev-parse', 'HEAD').trim();

  const { tasks, memories } = await mineTasks(dir, {
    name: 'demo',
    url: '',
    license: 'MIT',
    language: 'typescript',
    commit: head,
  });
  // Kept: the two commits that change existing source. Dropped: the schema-only change, the
  // chore, the message too short to be a task, and the initial import (it only adds files).
  expect(tasks.map((t) => t.commit)).toEqual([fix, feature]);
  expect(memories).toEqual([]);
  expect(tasks[0]).toMatchObject({
    repo: 'demo',
    text: 'fix(hash): use a larger multiplier so short passwords collide less',
    files: ['src/hash.ts'],
    symbols: [{ path: 'src/hash.ts', name: 'hash', startLine: 4, endLine: 10 }],
  });
  // The task is located in the tree before the commit; the added file is not ground truth.
  expect(tasks[0]?.parent).toBe(git('rev-parse', `${fix}^`).trim());
  expect(tasks[1]?.files).toEqual(['src/auth.ts']);
  expect(tasks[1]?.symbols.map((s) => s.name)).toEqual(['authenticateUser']);
  expect(tasks.map((t) => t.split)).toEqual(['train', 'train']);
}, 60_000);

const TASK: BenchTask = {
  id: 'demo1',
  repo: 'ts-app',
  commit: '',
  parent: '',
  text: 'fix(auth): authenticateUser should reject unknown users before hashing the password',
  files: ['src/auth.ts'],
  symbols: [{ path: 'src/auth.ts', name: 'authenticateUser', startLine: 14, endLine: 23 }],
  split: 'test',
};

test('keywords put identifiers first, and the grep baseline reads whole files in rank order', () => {
  expect(extractKeywords(TASK.text)).toEqual([
    'authenticateUser',
    'password',
    'unknown',
    'hashing',
    'reject',
    'before',
    'users',
    'auth',
  ]);
  const files = scan('test/fixtures/ts-app').map(({ path }) => {
    const content = readFileSync(join('test/fixtures/ts-app', path), 'utf8');
    return { path, content, tokens: countTokens(content) };
  });
  const scored = grepBaseline(files, TASK);
  expect(scored).toMatchObject({
    fileRecall: 1,
    symbolRecall: 1,
    strictFileRecall: 1,
    recallAt10: 1,
  });
  expect(scored.hitAt10).toBe(true);
  // It stops once the ground-truth file is read, and counts every token read on the way.
  expect(scored.firstHitTokens).toBe(scored.tokens);
  expect(scored.tokens).toBeGreaterThanOrEqual(
    files.find((f) => f.path === 'src/auth.ts')?.tokens ?? 0,
  );
  // With a cap too small for anything, the right file is ranked but never read.
  const capped = grepBaseline(files, TASK, 0);
  expect(capped).toMatchObject({
    fileRecall: 0,
    firstHitTokens: null,
    tokens: 0,
    hitAt10: true,
    recallAt10: 1,
  });
  // A task whose words appear nowhere finds nothing.
  expect(grepBaseline(files, { ...TASK, text: 'zzzqqq xyzzyplugh' })).toMatchObject({
    fileRecall: 0,
    reciprocalRank: 0,
    hitAt10: false,
  });
});

test('a remimem answer is scored by the blocks an agent would read', async () => {
  const { root, store } = await indexed('ts-app');
  const ctx = { root, config: TEST_CONFIG, store, provider: null };
  const scored = await evaluateQuery(ctx, TASK, { k: 20, budget: 2000 });
  expect(scored).toMatchObject({
    fileRecall: 1,
    symbolRecall: 1,
    recallAt10: 1,
    strictFileRecall: 1,
    strictSymbolRecall: 1,
    reciprocalRank: 1,
    hitAt10: true,
  });
  // A file that appears only as a signature counts for recall, but not for the strict figure.
  const pointer = await evaluateQuery(
    ctx,
    { ...TASK, text: 'authenticateUser', files: ['src/hash.ts'], symbols: [] },
    { k: 1, budget: 2000 },
  );
  expect(pointer).toMatchObject({ fileRecall: 1, strictFileRecall: 0 });
  // Two files wanted, one of them ranked: recall@10 is the share, not a yes or no.
  const half = await evaluateQuery(
    ctx,
    { ...TASK, files: ['src/auth.ts', 'src/nope.ts'], symbols: [] },
    { k: 20, budget: 2000 },
  );
  expect(half).toMatchObject({ recallAt10: 0.5, hitAt10: true });
  expect(scored.tokens).toBeLessThanOrEqual(2000);
  expect(scored.firstHitTokens).toBeGreaterThan(0);
  expect(scored.firstHitTokens).toBeLessThanOrEqual(scored.tokens);
  // A symbol that is not in the answer does not count, even when its file does.
  const other = {
    ...TASK,
    symbols: [{ path: 'src/auth.ts', name: 'missing', startLine: 900, endLine: 910 }],
  };
  expect((await evaluateQuery(ctx, other, { k: 20, budget: 2000 })).symbolRecall).toBe(0);
  const miss = await evaluateQuery(
    ctx,
    { ...TASK, files: ['src/nope.ts'], symbols: [] },
    { k: 5, budget: 500 },
  );
  expect(miss).toMatchObject({
    fileRecall: 0,
    symbolRecall: null,
    firstHitTokens: null,
    reciprocalRank: 0,
  });

  const text =
    '--- a.ts:1-3 function a [keyword]\nx\n\n--- b.ts:10-20 function b [vector]\ny\n\n~20 tokens | 2 results';
  const withPointer = text.replace('[vector]', '[calls a] (signature only)');
  expect(
    parseBlocks(withPointer).map((b) => [b.path, b.startLine, b.endLine, b.signatureOnly]),
  ).toEqual([
    ['a.ts', 1, 3, false],
    ['b.ts', 10, 20, true],
  ]);
  store.close();
});

test('strategies cover the baseline comparison, three budgets, and every ablation', () => {
  const names = strategies(TEST_CONFIG.retrieval).map((s) => s.name);
  expect(names).toEqual([
    'search_code@2000',
    'search_code@4000',
    'search_code@8000',
    'get_context@2000',
    'get_context@4000',
    'get_context@8000',
    'ablation: keyword only',
    'ablation: vector only',
    'ablation: no graph expansion',
    'ablation: no signature compression',
    'ablation: no name-match edges',
    'ablation: with memories',
  ]);
  const tuning = tuningStrategies(TEST_CONFIG.retrieval).map((s) => s.name);
  expect(tuning).toContain('tune: rrfK=20');
  // The current default is not tried again.
  expect(tuning).not.toContain(`tune: rrfK=${TEST_CONFIG.retrieval.rrfK}`);
  expect(tuning.filter((n) => n.startsWith('tune: memory'))).toHaveLength(12);
});

test('summaries aggregate the test split, and the report names the machine and the misses', () => {
  const results = fakeResults();
  const test = results.tasks.filter((t) => t.split === 'test');
  // Task t2 returns half of its files, and that half only as a signature.
  expect(summarize(test, MAIN_STRATEGY)).toMatchObject({
    tasks: 2,
    fileRecall: 0.75,
    strictFileRecall: 0.5,
    recallAt10: 0.75,
    hitAt10: 1,
    mrr: 0.75,
    tokens: 3000,
    // t2 is incomplete, so it costs the cap when misses are charged: (3,000 + 40,000) / 2.
    tokensAtCap: 21500,
  });
  // The baseline read 30,000 on t1 and missed t2, which counts as 40,000.
  expect(summarize(test, 'baseline')).toMatchObject({
    fileRecall: 0.5,
    recallAt10: 0.5,
    tokensAtCap: 35000,
  });
  expect(summarize(test, 'ablation: with memories')).toMatchObject({
    memoryPrecision: 0.25,
    memoryRecall: 1,
    memoriesPerTask: 2,
  });

  const report = renderSummary(results);
  expect(report).toContain(
    'on Test CPU (8 cores, 16 GB, linux 6, Node.js v22.13.0), embedding model `local:test-model`',
  );
  expect(report).toContain('Test split: 2 of 3 tasks');
  expect(report).toContain(
    '**Headline (test split, 2 tasks, `get_context@4000` against the grep baseline).**',
  );
  // Tokens over every test task, the baseline's misses at the cap.
  expect(report).toContain(
    'Tokens: remimem serves 3,000 per call on average; the baseline reads 35,000 per task on average, with each task where it did not read every ground-truth file counted at its 40,000-token cap. That is 91% fewer (target: at least 40% fewer). Charging remimem the same cap for each task where its answer lacks a ground-truth file gives 21,500, 39% fewer.',
  );
  // Recall@10 is a share of files averaged over tasks, compared with the target.
  expect(report).toContain(
    "Recall@10: on average 0.75 of a task's ground-truth files are among the ten best-ranked files (baseline 0.50; target 0.80).",
  );
  expect(report).toContain(
    'File recall in the answer: 75% (baseline 50%); counting a file only when a full body from it is shown, not a signature-only block: 50%.',
  );
  expect(report).not.toContain('where both reached');
  expect(report).toContain(
    '| baseline: grep and read whole files, 40,000-token cap | 35,000 | 50% | 50% |',
  );
  expect(report).toContain(
    '- demo `t2`: "fix: task t2" wanted `src/a.ts`; file recall 50%, first ground-truth file ranked 2.',
  );
  expect(report).toContain('Re-indexing after a 20-file change on demo: 0.5s.');
  expect(renderTuning(results)).toContain('| rrfK=20 | 50.0% |');
  const withOther = renderSummary(results, [{ ...results, embeddingModel: 'local:other-model' }]);
  expect(withOther).toContain('| `local:other-model` |');
});

test('the headline is also given without a test task that was inspected before tuning', () => {
  const results = fakeResults();
  expect(renderSummary(results)).not.toContain('The same without');
  (results.tasks[1] as TaskResult).id = INSPECTED_TASKS[0] as string;
  const report = renderSummary(results);
  expect(report).toContain(`**The same without demo \`${INSPECTED_TASKS[0]}\`** (1 tasks)`);
  // Without the incomplete task, the figures on the remaining one are perfect.
  expect(report).toContain("Recall@10: on average 1.00 of a task's ground-truth files");
});

test('a rerun is compared with a tolerance, and the README section is replaced in place', () => {
  const expected = fakeResults();
  expect(compareResults(expected, fakeResults({ fileRecall: 0.96 })).ok).toBe(true);
  const worse = compareResults(
    expected,
    fakeResults({ fileRecall: 0.5, hitAt10: false, reciprocalRank: 0 }),
  );
  expect(worse.ok).toBe(false);
  expect(worse.lines.filter((line) => line.startsWith('DIFF')).length).toBeGreaterThan(0);

  const readme = join(mkdtempSync(join(tmpdir(), 'remimem-readme-')), 'README.md');
  writeFileSync(readme, `# Title\n\n${README_START}\nold numbers\n${README_END}\n\nAfter.\n`);
  updateReadme(readme, 'new numbers');
  expect(readFileSync(readme, 'utf8')).toBe(
    `# Title\n\n${README_START}\n\nnew numbers\n\n${README_END}\n\nAfter.\n`,
  );
  writeFileSync(readme, '# No markers\n');
  expect(() => updateReadme(readme, 'x')).toThrow(/markers/);
});

test('the benchmark data in this repo is complete, and the README shows the latest results', () => {
  const repos = readRepos();
  expect(repos.map((r) => r.language).sort()).toEqual(['go', 'python', 'typescript']);
  for (const repo of repos) {
    expect(repo.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(repo.license).not.toBe('');
    const tasks = readFileSync(join(benchDir(), 'tasks', `${repo.name}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BenchTask);
    expect(tasks.length).toBeGreaterThanOrEqual(25);
    expect(tasks.length).toBeLessThanOrEqual(40);
    // One third is held out.
    expect(tasks.filter((t) => t.split === 'test').length).toBe(Math.floor(tasks.length / 3));
    for (const task of tasks) {
      expect(task.files.length).toBeGreaterThan(0);
      expect(task.files.length).toBeLessThanOrEqual(8);
    }
  }
  // Every number in the README comes from the newest results file, by the same code.
  const { main, others } = latestResults(join(benchDir(), 'results'));
  if (!main) throw new Error('no benchmark results file for the default model');
  const readme = readFileSync(join(benchDir(), '..', 'README.md'), 'utf8');
  const section = readme
    .slice(readme.indexOf(README_START) + README_START.length, readme.indexOf(README_END))
    .trim();
  expect(section).toBe(renderSummary(main, others));
});

test('the end-to-end hook prints its cost estimate and runs nothing without --yes', async () => {
  const { runE2e } = await import('../src/bench/e2e.js');
  const lines: string[] = [];
  runE2e({ tasks: 3, pricePerMillion: 3, yes: false }, (line) => lines.push(line));
  expect(lines).toEqual([
    'End-to-end run: 3 test tasks in each of 3 repositories, each with and without remimem: 18 agent runs.',
    "Estimated cost: about 3.6 million input tokens (assuming 200,000 per run), about $11 at $3 per million. Both figures are assumptions; check your model's price.",
    'Nothing was run. Add --yes to start. This uses your Claude Code account and costs money.',
  ]);
});
