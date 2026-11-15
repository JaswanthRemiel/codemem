import { query, type ToolContext } from '../mcp/tools.js';
import { queryTokens } from '../retriever/index.js';
import { countTokens } from '../tokens.js';
import type { BenchMemory, BenchTask } from './mine.js';

/** What one strategy achieved on one task. */
export interface StrategyResult {
  /** Share of the ground-truth files present in what was returned. */
  fileRecall: number;
  /** Share of the ground-truth symbols present, or null when the task has none. */
  symbolRecall: number | null;
  /** Tokens read up to and including the first ground-truth file, or null if never reached. */
  firstHitTokens: number | null;
  /** Total tokens returned (codemem) or read (baseline). */
  tokens: number;
  /** 1 / rank of the first ground-truth file in the ranking, 0 when it is not ranked. */
  reciprocalRank: number;
  /** True when a ground-truth file is among the ten best-ranked files. */
  hitAt10: boolean;
  latencyMs: number;
  /** Memory ablation only: memories attached, how many were relevant, how many relevant existed. */
  memory?: { attached: number; relevant: number; available: number };
}

export interface FileText {
  path: string;
  content: string;
  tokens: number;
}

/** Words too common in commit messages to be useful search keywords. */
const COMMON = new Set(
  'add added adds allow also and are bug can change changed changes does error false feat fix fixed fixes for from has have issue make more new not now null only remove removed return returns set should support test tests that the this true type update updated use used using value was when which will with'.split(
    ' ',
  ),
);

/**
 * The keywords a grep-driven agent would search for: identifier-like words first, then the
 * longest remaining words, at most eight.
 */
export function extractKeywords(text: string): string[] {
  const words = queryTokens(text)
    .flatMap((token) => (token.includes('.') ? [token.split('.').at(-1) ?? token] : [token]))
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !COMMON.has(w.toLowerCase()));
  const identifier = (w: string): boolean => /[_$\d]|[a-z][A-Z]/.test(w);
  const unique = [...new Set(words)];
  return [
    ...unique.filter(identifier),
    ...unique.filter((w) => !identifier(w)).sort((a, b) => b.length - a.length),
  ].slice(0, 8);
}

/**
 * The baseline: how an agent explores with grep today. It searches for the task's keywords,
 * ranks files by how many distinct keywords they contain (then by total matches), and reads
 * whole files in that order until every ground-truth file has been read or `cap` tokens are
 * used. The search is done in process and matches what `rg --ignore-case --word-regexp`
 * would count.
 */
export function grepBaseline(files: FileText[], task: BenchTask, cap = 40_000): StrategyResult {
  const started = performance.now();
  const patterns = extractKeywords(task.text).map(
    (word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
  );
  const ranked = files
    .map((file) => {
      const counts = patterns.map((pattern) => file.content.match(pattern)?.length ?? 0);
      return {
        file,
        distinct: counts.filter((n) => n > 0).length,
        total: counts.reduce((sum, n) => sum + n, 0),
      };
    })
    .filter((entry) => entry.distinct > 0)
    .sort(
      (a, b) =>
        b.distinct - a.distinct || b.total - a.total || (a.file.path < b.file.path ? -1 : 1),
    );
  const latencyMs = performance.now() - started;

  const truth = new Set(task.files);
  const read = new Set<string>();
  let tokens = 0;
  let firstHitTokens: number | null = null;
  for (const { file } of ranked) {
    if (tokens >= cap || task.files.every((path) => read.has(path))) break;
    tokens += file.tokens;
    read.add(file.path);
    if (firstHitTokens === null && truth.has(file.path)) firstHitTokens = tokens;
  }
  const rank = ranked.findIndex(({ file }) => truth.has(file.path)) + 1;
  return {
    fileRecall: task.files.filter((path) => read.has(path)).length / task.files.length,
    // Reading a whole file brings every symbol in it.
    symbolRecall:
      task.symbols.length === 0
        ? null
        : task.symbols.filter((s) => read.has(s.path)).length / task.symbols.length,
    firstHitTokens,
    tokens,
    reciprocalRank: rank ? 1 / rank : 0,
    hitAt10: rank > 0 && rank <= 10,
    latencyMs,
  };
}

interface Block {
  path: string;
  startLine: number;
  endLine: number;
  /** Tokens of the output up to the end of this block. */
  tokensThrough: number;
}

/** The code blocks of a packed answer, in reading order. */
export function parseBlocks(text: string): Block[] {
  const headers = [...text.matchAll(/^--- (.+?):(\d+)-(\d+) /gm)];
  return headers.map((match, i) => {
    const next = headers[i + 1]?.index ?? text.length;
    return {
      path: match[1] as string,
      startLine: Number(match[2]),
      endLine: Number(match[3]),
      tokensThrough: countTokens(text.slice(0, next)),
    };
  });
}

/** Runs one codemem query and scores what an agent would see in the answer. */
export async function evaluateQuery(
  ctx: ToolContext,
  task: BenchTask,
  options: { k: number; budget: number; memories?: boolean },
  memories: BenchMemory[] = [],
): Promise<StrategyResult> {
  const started = performance.now();
  const result = await query(ctx, task.text, options);
  const latencyMs = performance.now() - started;
  const blocks = parseBlocks(result.text);
  const truth = new Set(task.files);
  const present = new Set(blocks.map((b) => b.path));
  const rank = (result.rankedFiles ?? []).findIndex((path) => truth.has(path)) + 1;
  const scored: StrategyResult = {
    fileRecall: task.files.filter((path) => present.has(path)).length / task.files.length,
    symbolRecall:
      task.symbols.length === 0
        ? null
        : task.symbols.filter((s) =>
            blocks.some(
              (b) => b.path === s.path && b.startLine <= s.endLine && b.endLine >= s.startLine,
            ),
          ).length / task.symbols.length,
    firstHitTokens: blocks.find((b) => truth.has(b.path))?.tokensThrough ?? null,
    tokens: countTokens(result.text),
    reciprocalRank: rank ? 1 / rank : 0,
    hitAt10: rank > 0 && rank <= 10,
    latencyMs,
  };
  if (options.memories) {
    const relevant = new Set(
      memories.filter((m) => m.files.some((path) => truth.has(path))).map((m) => m.id),
    );
    const attached = [...result.text.matchAll(/^\[\w+\] (m_[0-9a-f]+)/gm)].map(
      (m) => m[1] as string,
    );
    scored.memory = {
      attached: attached.length,
      relevant: attached.filter((id) => relevant.has(id)).length,
      available: relevant.size,
    };
  }
  return scored;
}
