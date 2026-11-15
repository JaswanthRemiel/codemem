import { readFileSync, writeFileSync } from 'node:fs';
import { BASELINE_CAP, type StrategyResult } from './evaluate.js';
import {
  BUDGETS,
  INSPECTED_TASKS,
  MAIN_BUDGET,
  MAIN_STRATEGY,
  type BenchResults,
  type TaskResult,
} from './index.js';

export const README_START = '<!-- bench:start -->';
export const README_END = '<!-- bench:end -->';

export interface Summary {
  tasks: number;
  fileRecall: number;
  /** File recall when only a full body counts, not a signature-only block. */
  strictFileRecall: number;
  /** Over tasks that have ground-truth symbols. */
  symbolRecall: number;
  strictSymbolRecall: number;
  /** Mean share of a task's ground-truth files among the ten best-ranked files. */
  recallAt10: number;
  /** Share of tasks with at least one ground-truth file among the ten best-ranked files. */
  hitAt10: number;
  mrr: number;
  /** Share of tasks in which a ground-truth file was reached at all. */
  reached: number;
  /** Median tokens to the first ground-truth file, over tasks where it was reached. */
  firstHitTokens: number;
  /** Mean tokens returned or read. */
  tokens: number;
  /** Mean tokens when a task whose ground-truth files were not all returned costs the cap. */
  tokensAtCap: number;
  latencyP50: number;
  latencyP95: number;
  /** Memory ablation: relevant share of attached memories, and share of tasks served. */
  memoryPrecision?: number;
  memoryRecall?: number;
  memoriesPerTask?: number;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] as number;
}
const defined = (xs: (number | null)[]): number[] => xs.flatMap((x) => (x === null ? [] : [x]));

/** Aggregates one strategy over a set of tasks. */
export function summarize(tasks: TaskResult[], strategy: string): Summary {
  const rows = tasks.flatMap((t) => t.strategies[strategy] ?? []) as StrategyResult[];
  const hits = defined(rows.map((r) => r.firstHitTokens));
  const summary: Summary = {
    tasks: rows.length,
    fileRecall: mean(rows.map((r) => r.fileRecall)),
    strictFileRecall: mean(rows.map((r) => r.strictFileRecall)),
    symbolRecall: mean(defined(rows.map((r) => r.symbolRecall))),
    strictSymbolRecall: mean(defined(rows.map((r) => r.strictSymbolRecall))),
    recallAt10: mean(rows.map((r) => r.recallAt10)),
    hitAt10: mean(rows.map((r) => (r.hitAt10 ? 1 : 0))),
    mrr: mean(rows.map((r) => r.reciprocalRank)),
    reached: rows.length ? hits.length / rows.length : 0,
    firstHitTokens: quantile(hits, 0.5),
    tokens: mean(rows.map((r) => r.tokens)),
    tokensAtCap: mean(rows.map((r) => (r.fileRecall < 1 ? BASELINE_CAP : r.tokens))),
    latencyP50: quantile(
      rows.map((r) => r.latencyMs),
      0.5,
    ),
    latencyP95: quantile(
      rows.map((r) => r.latencyMs),
      0.95,
    ),
  };
  const memory = rows.flatMap((r) => r.memory ?? []);
  if (memory.length > 0) {
    const attached = memory.reduce((n, m) => n + m.attached, 0);
    const served = memory.filter((m) => m.available > 0);
    summary.memoryPrecision = attached ? memory.reduce((n, m) => n + m.relevant, 0) / attached : 0;
    summary.memoryRecall = served.length
      ? served.filter((m) => m.relevant > 0).length / served.length
      : 0;
    summary.memoriesPerTask = attached / memory.length;
  }
  return summary;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const num = (x: number): string => Math.round(x).toLocaleString('en-US');
const fewer = (ours: number, theirs: number): string =>
  theirs <= 0
    ? 'not comparable'
    : ours <= theirs
      ? `${pct(1 - ours / theirs)} fewer`
      : `${pct(ours / theirs - 1)} more`;

/** One table row. The baseline's token figure counts its misses at the cap. */
function row(label: string, s: Summary, baseline = false): string {
  return `| ${label} | ${num(baseline ? s.tokensAtCap : s.tokens)} | ${pct(s.fileRecall)} | ${pct(s.strictFileRecall)} | ${pct(s.symbolRecall)} | ${s.recallAt10.toFixed(2)} | ${s.mrr.toFixed(2)} | ${pct(s.reached)} | ${num(s.firstHitTokens)} | ${num(s.latencyP50)} / ${num(s.latencyP95)} ms |`;
}

const HEADER = [
  '| Strategy | Tokens per task | File recall | File recall, full body only | Symbol recall | Recall@10 | MRR | Reached | Tokens to first hit | Latency p50 / p95 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];

const strategyNames = (results: BenchResults, prefix: string): string[] =>
  [...new Set(results.tasks.flatMap((t) => Object.keys(t.strategies)))].filter((name) =>
    name.startsWith(prefix),
  );

/** The headline sentences for one set of tasks: tokens, recall@10, and file recall. */
function headline(tasks: TaskResult[]): string {
  const b = summarize(tasks, 'baseline');
  const c = summarize(tasks, MAIN_STRATEGY);
  return [
    `Tokens: remimem serves ${num(c.tokens)} per call on average; the baseline reads ${num(b.tokensAtCap)} per task on average, with each task where it did not read every ground-truth file counted at its ${num(BASELINE_CAP)}-token cap. That is ${fewer(c.tokens, b.tokensAtCap)} (target: at least 40% fewer). Charging remimem the same cap for each task where its answer lacks a ground-truth file gives ${num(c.tokensAtCap)}, ${fewer(c.tokensAtCap, b.tokensAtCap)}.`,
    `Recall@10: on average ${c.recallAt10.toFixed(2)} of a task's ground-truth files are among the ten best-ranked files (baseline ${b.recallAt10.toFixed(2)}; target 0.80).`,
    `File recall in the answer: ${pct(c.fileRecall)} (baseline ${pct(b.fileRecall)}); counting a file only when a full body from it is shown, not a signature-only block: ${pct(c.strictFileRecall)}.`,
  ].join(' ');
}

/** The Markdown that goes into the README: headline, tables, ablations, worst misses. */
export function renderSummary(results: BenchResults, otherModels: BenchResults[] = []): string {
  const test = results.tasks.filter((t) => t.split === 'test');
  const baseline = summarize(test, 'baseline');
  const main = summarize(test, MAIN_STRATEGY);
  const m = results.machine;
  const out: string[] = [];

  out.push(
    `Measured on ${results.date} with remimem \`${results.gitSha}\` on ${m.cpu} (${m.cores} cores, ${m.memoryGb} GB, ${m.os}, Node.js ${m.node}), embedding model \`${results.embeddingModel}\`. Test split: ${test.length} of ${results.tasks.length} tasks, held out from tuning. Ground-truth files are the non-test source files a task's commit changed. Token counts are approximate.`,
    '',
    `**Headline (test split, ${test.length} tasks, \`${MAIN_STRATEGY}\` against the grep baseline).** ${headline(test)}`,
  );
  const clean = test.filter((t) => !INSPECTED_TASKS.includes(t.id));
  if (clean.length < test.length) {
    const inspected = test.filter((t) => INSPECTED_TASKS.includes(t.id));
    out.push(
      '',
      `**The same without ${inspected.map((t) => `${t.repo} \`${t.id}\``).join(', ')}** (${clean.length} tasks), a test task that was inspected while the harness was being debugged, before tuning: ${headline(clean)}`,
    );
  }
  out.push(
    '',
    ...HEADER,
    row(`baseline: grep and read whole files, ${num(BASELINE_CAP)}-token cap`, baseline, true),
    ...BUDGETS.map((b) =>
      row(`\`search_code\` at ${num(b)} tokens`, summarize(test, `search_code@${b}`)),
    ),
    ...BUDGETS.map((b) =>
      row(`\`get_context\` at ${num(b)} tokens`, summarize(test, `get_context@${b}`)),
    ),
    '',
    `Columns: *tokens per task* is the mean size of the answer; for the baseline it is what it read, with a task counted at the ${num(BASELINE_CAP)}-token cap when it did not read every ground-truth file. *File recall* and *symbol recall* are the share of ground-truth files and symbols present in what was returned (for the baseline, in the files it read); *full body only* does not count a file that appears only as a signature. *Recall@10* is the share of a task's ground-truth files among the ten best-ranked files, averaged over tasks, and *MRR* the mean reciprocal rank of the first one. *Reached* is the share of tasks in which any ground-truth file was returned, and *tokens to first hit* the median over those tasks.`,
    '',
    `Ablations of \`get_context\` at ${num(MAIN_BUDGET)} tokens (test split):`,
    '',
    ...HEADER,
    row('full', main),
    ...strategyNames(results, 'ablation: ').map((name) =>
      row(name.replace('ablation: ', ''), summarize(test, name)),
    ),
  );
  const memory = summarize(test, 'ablation: with memories');
  if (memory.memoryPrecision !== undefined) {
    out.push(
      '',
      `Memory ablation: each repo gets 60 memories made from older commit subjects, unlinked, so they have to match the task text. With memories on, ${memory.memoriesPerTask?.toFixed(1)} are attached per task; ${pct(memory.memoryPrecision)} of attached memories come from a commit that touched a ground-truth file, and ${pct(memory.memoryRecall ?? 0)} of the tasks that have such a memory get at least one.`,
    );
  }

  out.push(
    '',
    'Per repository (test split):',
    '',
    '| Repository | Language | Lines | Tasks | Baseline tokens per task | `get_context` tokens per task | Baseline recall@10 | `get_context` recall@10 | Baseline file recall | `get_context` file recall |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const repo of results.repos) {
    const tasks = test.filter((t) => t.repo === repo.name);
    const b = summarize(tasks, 'baseline');
    const c = summarize(tasks, MAIN_STRATEGY);
    out.push(
      `| [${repo.name}](${repo.url.replace(/\.git$/, '')}) at \`${repo.commit.slice(0, 10)}\` (${repo.license}) | ${repo.language} | ${num(repo.lines)} | ${tasks.length} | ${num(b.tokensAtCap)} | ${num(c.tokens)} | ${b.recallAt10.toFixed(2)} | ${c.recallAt10.toFixed(2)} | ${pct(b.fileRecall)} | ${pct(c.fileRecall)} |`,
    );
  }

  const misses = test
    .map((t) => ({ t, r: t.strategies[MAIN_STRATEGY] }))
    .filter((x) => x.r && x.r.fileRecall < 1)
    .sort(
      (a, b) =>
        (a.r?.fileRecall ?? 0) - (b.r?.fileRecall ?? 0) ||
        (a.r?.reciprocalRank ?? 0) - (b.r?.reciprocalRank ?? 0),
    )
    .slice(0, 10);
  out.push(
    '',
    `Worst misses of \`${MAIN_STRATEGY}\` on the test split (${misses.length} shown):`,
    '',
  );
  for (const { t, r } of misses) {
    out.push(
      `- ${t.repo} \`${t.id}\`: "${t.title.replaceAll('|', '/')}" wanted ${t.files.map((f) => `\`${f}\``).join(', ')}; file recall ${pct(r?.fileRecall ?? 0)}, first ground-truth file ranked ${r?.reciprocalRank ? Math.round(1 / r.reciprocalRank) : 'nowhere'}.`,
    );
  }
  if (otherModels.length > 0) {
    out.push(
      '',
      `Embedding models compared (\`${MAIN_STRATEGY}\`, test split):`,
      '',
      '| Model | Tokens per task | File recall | File recall, full body only | Symbol recall | Recall@10 | MRR | Latency p50 / p95 | First full index of all repos |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const r of [results, ...otherModels]) {
      const s = summarize(
        r.tasks.filter((t) => t.split === 'test'),
        MAIN_STRATEGY,
      );
      const seconds = r.repos.reduce((n, repo) => n + repo.indexSeconds, 0);
      out.push(
        `| \`${r.embeddingModel}\` | ${num(s.tokens)} | ${pct(s.fileRecall)} | ${pct(s.strictFileRecall)} | ${pct(s.symbolRecall)} | ${s.recallAt10.toFixed(2)} | ${s.mrr.toFixed(2)} | ${num(s.latencyP50)} / ${num(s.latencyP95)} ms | ${seconds > 0 ? `${num(seconds)}s` : 'not measured (index was cached)'} |`,
      );
    }
  }
  if (results.reindex) {
    out.push(
      '',
      `Re-indexing after a 20-file change on ${results.reindex.repo}: ${results.reindex.seconds}s.`,
    );
  }
  out.push(
    '',
    'Reproduce with `npm install && npx . bench` from a clone. Results vary slightly between CPU types, because the quantized embedding model rounds differently; `npx . bench --compare <results file>` reruns and checks each headline figure against a tolerance.',
  );
  return out.join('\n');
}

/** The tuning table: configurations tried on the training split. Not part of the README. */
export function renderTuning(results: BenchResults): string {
  const train = results.tasks.filter((t) => t.split === 'train');
  const names = strategyNames(results, 'tune: ');
  if (names.length === 0) return '';
  const out = [
    `Tuning on the training split (${train.length} tasks), \`get_context\` at ${num(MAIN_BUDGET)} tokens:`,
    '',
    '| Configuration | File recall | Symbol recall | Recall@10 | MRR | Memory precision | Memory recall | Memories per task |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const name of [
    MAIN_STRATEGY,
    'ablation: with memories',
    ...strategyNames(results, 'ablation: ').filter((n) => n.includes('name-match')),
    ...names,
  ]) {
    const s = summarize(train, name);
    const memory =
      s.memoryPrecision === undefined
        ? '| | |'
        : `${pct(s.memoryPrecision)} | ${pct(s.memoryRecall ?? 0)} | ${s.memoriesPerTask?.toFixed(1)}`;
    out.push(
      `| ${name.replace('tune: ', '')} | ${(s.fileRecall * 100).toFixed(1)}% | ${(s.symbolRecall * 100).toFixed(1)}% | ${s.recallAt10.toFixed(3)} | ${s.mrr.toFixed(3)} | ${memory} |`,
    );
  }
  return out.join('\n');
}

/** Replaces the text between the benchmark markers in the README. */
export function updateReadme(readmePath: string, summary: string): void {
  const readme = readFileSync(readmePath, 'utf8');
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${readmePath} has no ${README_START} ... ${README_END} markers`);
  }
  writeFileSync(
    readmePath,
    `${readme.slice(0, start + README_START.length)}\n\n${summary}\n\n${readme.slice(end)}`,
  );
}

/**
 * Compares the headline figures of two runs. Recall-like figures may differ by `0.05` and
 * token figures by 15%: results shift slightly between CPU types.
 */
export function compareResults(
  expected: BenchResults,
  actual: BenchResults,
): { lines: string[]; ok: boolean } {
  const test = (r: BenchResults): TaskResult[] => r.tasks.filter((t) => t.split === 'test');
  const lines: string[] = [];
  let ok = true;
  for (const strategy of ['baseline', MAIN_STRATEGY]) {
    const a = summarize(test(expected), strategy);
    const b = summarize(test(actual), strategy);
    const tokens = (x: Summary): number => (strategy === 'baseline' ? x.tokensAtCap : x.tokens);
    const close = (want: number, got: number): boolean => Math.abs(want - got) <= 0.05;
    const checks: [string, number, number, boolean][] = [
      ['file recall', a.fileRecall, b.fileRecall, close(a.fileRecall, b.fileRecall)],
      ['recall@10', a.recallAt10, b.recallAt10, close(a.recallAt10, b.recallAt10)],
      ['MRR', a.mrr, b.mrr, close(a.mrr, b.mrr)],
      [
        'tokens per task',
        tokens(a),
        tokens(b),
        Math.abs(tokens(a) - tokens(b)) <= 0.15 * Math.max(tokens(a), 1),
      ],
    ];
    for (const [label, want, got, within] of checks) {
      if (!within) ok = false;
      lines.push(
        `${within ? 'ok  ' : 'DIFF'} ${strategy} ${label}: expected ${want.toFixed(3)}, got ${got.toFixed(3)}`,
      );
    }
  }
  return { lines, ok };
}
