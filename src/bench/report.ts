import { readFileSync, writeFileSync } from 'node:fs';
import type { StrategyResult } from './evaluate.js';
import {
  BUDGETS,
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
  /** Over tasks that have ground-truth symbols. */
  symbolRecall: number;
  hitAt10: number;
  mrr: number;
  /** Share of tasks in which a ground-truth file was reached at all. */
  reached: number;
  /** Median tokens to the first ground-truth file, over tasks where it was reached. */
  firstHitTokens: number;
  /** Mean tokens returned or read. */
  tokens: number;
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

/** Aggregates one strategy over a set of tasks. */
export function summarize(tasks: TaskResult[], strategy: string): Summary {
  const rows = tasks.flatMap((t) => t.strategies[strategy] ?? []) as StrategyResult[];
  const hits = rows.flatMap((r) => (r.firstHitTokens === null ? [] : [r.firstHitTokens]));
  const summary: Summary = {
    tasks: rows.length,
    fileRecall: mean(rows.map((r) => r.fileRecall)),
    symbolRecall: mean(rows.flatMap((r) => (r.symbolRecall === null ? [] : [r.symbolRecall]))),
    hitAt10: mean(rows.map((r) => (r.hitAt10 ? 1 : 0))),
    mrr: mean(rows.map((r) => r.reciprocalRank)),
    reached: rows.length ? hits.length / rows.length : 0,
    firstHitTokens: quantile(hits, 0.5),
    tokens: mean(rows.map((r) => r.tokens)),
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

function row(label: string, s: Summary): string {
  return `| ${label} | ${pct(s.fileRecall)} | ${pct(s.symbolRecall)} | ${pct(s.hitAt10)} | ${s.mrr.toFixed(2)} | ${pct(s.reached)} | ${num(s.firstHitTokens)} | ${num(s.tokens)} | ${num(s.latencyP50)} / ${num(s.latencyP95)} ms |`;
}

const HEADER = [
  '| Strategy | File recall | Symbol recall | Hit@10 | MRR | Reached | Tokens to first hit | Tokens used | Latency p50 / p95 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];

const strategyNames = (results: BenchResults, prefix: string): string[] =>
  [...new Set(results.tasks.flatMap((t) => Object.keys(t.strategies)))].filter((name) =>
    name.startsWith(prefix),
  );

/** The Markdown that goes into the README: headline, tables, ablations, worst misses. */
export function renderSummary(results: BenchResults, otherModels: BenchResults[] = []): string {
  const test = results.tasks.filter((t) => t.split === 'test');
  const baseline = summarize(test, 'baseline');
  const main = summarize(test, MAIN_STRATEGY);
  // Tokens to the first ground-truth file, on the tasks where both strategies reached one.
  const both = test.flatMap((t) => {
    const b = t.strategies['baseline']?.firstHitTokens;
    const c = t.strategies[MAIN_STRATEGY]?.firstHitTokens;
    return b != null && c != null ? [{ b, c }] : [];
  });
  const pairedBaseline = quantile(
    both.map((x) => x.b),
    0.5,
  );
  const pairedMain = quantile(
    both.map((x) => x.c),
    0.5,
  );
  const comparable = both.length > 0 && pairedBaseline > 0;
  const saving = comparable ? 1 - pairedMain / pairedBaseline : 0;
  const m = results.machine;
  const out: string[] = [];

  out.push(
    `Measured on ${results.date} with codemem \`${results.gitSha}\` on ${m.cpu} (${m.cores} cores, ${m.memoryGb} GB, ${m.os}, Node.js ${m.node}), embedding model \`${results.embeddingModel}\`. Test split: ${test.length} of ${results.tasks.length} tasks, held out from tuning. Token counts are approximate.`,
    '',
    `**Headline (test split, \`${MAIN_STRATEGY}\` against the grep baseline):** the right file is in the answer for ${pct(main.fileRecall)} of ground-truth files (baseline ${pct(baseline.fileRecall)}), a ground-truth file is among the ten best-ranked files in ${pct(main.hitAt10)} of tasks (baseline ${pct(baseline.hitAt10)}), and on the ${both.length} tasks where both reached a ground-truth file, the median tokens to get there are ${num(pairedMain)} against ${num(pairedBaseline)} (${!comparable ? 'not comparable' : saving >= 0 ? `${pct(saving)} fewer` : `${pct(-saving)} more`}).`,
    '',
    ...HEADER,
    row('baseline: grep and read whole files, 40,000-token cap', baseline),
    ...BUDGETS.map((b) =>
      row(`\`search_code\` at ${num(b)} tokens`, summarize(test, `search_code@${b}`)),
    ),
    ...BUDGETS.map((b) =>
      row(`\`get_context\` at ${num(b)} tokens`, summarize(test, `get_context@${b}`)),
    ),
    '',
    'Columns: *file recall* and *symbol recall* are the share of ground-truth files and symbols present in what was returned (for the baseline, in the files it read). *Hit@10* is the share of tasks with a ground-truth file among the ten best-ranked files, and *MRR* the mean reciprocal rank of the first one. *Reached* is the share of tasks in which a ground-truth file was returned at all; *tokens to first hit* is the median over those tasks. *Tokens used* is the mean size of the answer (for the baseline, of everything it read).',
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
    '| Repository | Language | Lines | Tasks | Baseline file recall | `get_context` file recall | Baseline tokens to first hit | `get_context` tokens to first hit |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const repo of results.repos) {
    const tasks = test.filter((t) => t.repo === repo.name);
    const b = summarize(tasks, 'baseline');
    const c = summarize(tasks, MAIN_STRATEGY);
    out.push(
      `| [${repo.name}](${repo.url.replace(/\.git$/, '')}) at \`${repo.commit.slice(0, 10)}\` (${repo.license}) | ${repo.language} | ${num(repo.lines)} | ${tasks.length} | ${pct(b.fileRecall)} | ${pct(c.fileRecall)} | ${num(b.firstHitTokens)} | ${num(c.firstHitTokens)} |`,
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
      '| Model | File recall | Symbol recall | Hit@10 | MRR | Latency p50 / p95 | First full index of all repos |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const r of [results, ...otherModels]) {
      const s = summarize(
        r.tasks.filter((t) => t.split === 'test'),
        MAIN_STRATEGY,
      );
      const seconds = r.repos.reduce((n, repo) => n + repo.indexSeconds, 0);
      out.push(
        `| \`${r.embeddingModel}\` | ${pct(s.fileRecall)} | ${pct(s.symbolRecall)} | ${pct(s.hitAt10)} | ${s.mrr.toFixed(2)} | ${num(s.latencyP50)} / ${num(s.latencyP95)} ms | ${seconds > 0 ? `${num(seconds)}s` : 'not measured (index was cached)'} |`,
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
    '| Configuration | File recall | Symbol recall | Hit@10 | MRR | Memory precision | Memory recall | Memories per task |',
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
      `| ${name.replace('tune: ', '')} | ${(s.fileRecall * 100).toFixed(1)}% | ${(s.symbolRecall * 100).toFixed(1)}% | ${(s.hitAt10 * 100).toFixed(1)}% | ${s.mrr.toFixed(3)} | ${memory} |`,
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
    const checks: [string, number, number, boolean][] = [
      ['file recall', a.fileRecall, b.fileRecall, Math.abs(a.fileRecall - b.fileRecall) <= 0.05],
      ['hit@10', a.hitAt10, b.hitAt10, Math.abs(a.hitAt10 - b.hitAt10) <= 0.05],
      ['MRR', a.mrr, b.mrr, Math.abs(a.mrr - b.mrr) <= 0.05],
      [
        'tokens to first hit',
        a.firstHitTokens,
        b.firstHitTokens,
        Math.abs(a.firstHitTokens - b.firstHitTokens) <= 0.15 * Math.max(a.firstHitTokens, 1),
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
