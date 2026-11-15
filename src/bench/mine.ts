import { execFileSync } from 'node:child_process';
import { languageOf, parseSource } from '../parser/index.js';

/** A repository the benchmark runs on, pinned to one commit. */
export interface BenchRepo {
  name: string;
  url: string;
  license: string;
  language: string;
  /** Tasks are mined from the history that ends at this commit. */
  commit: string;
}

/** One task: a real commit, described by its message, to be located in its parent's tree. */
export interface BenchTask {
  id: string;
  repo: string;
  commit: string;
  /** The tree that is indexed for this task, so the answer is not in the index. */
  parent: string;
  /** The commit message: what a developer would have been asked to do. */
  text: string;
  /** Ground truth: source files the commit changed that exist in the parent. */
  files: string[];
  /** Ground truth: symbols of the parent tree whose lines the commit changed. */
  symbols: { path: string; name: string; startLine: number; endLine: number }[];
  split: 'train' | 'test';
}

/** An older commit, used as a project memory in the memory ablation. */
export interface BenchMemory {
  id: string;
  text: string;
  /** Files the commit changed: how the harness judges whether the memory is relevant. */
  files: string[];
}

const BOT = /\[bot\]|dependabot|renovate|github-actions/i;
/** Commit subjects that are not a bug fix or feature. */
const SKIP_SUBJECT =
  /^(chore|docs?|ci|build|style|tests?|release|bump|revert|merge|deps?|typo|lint|format|refactor\(deps\))\b|^v?\d+\.\d+(\.\d+)?\b|^update (dependencies|changelog|readme)/i;
const TEST_PATH =
  /(^|\/)(tests?|__tests__|testing|testdata|fixtures|examples?|docs?|benchmarks?|bench|e2e|integration|scripts?)\/|(_test\.go|\.(test|spec)\.[cm]?[jt]sx?|_test\.py|\.d\.ts)$|(^|\/)(test_[^/]*\.py|conftest\.py)$/;

const MAX_FILES = 8;

/**
 * This repo bans em dashes and emojis in every tracked file, task files included, so they
 * are replaced in mined text. The wording of a task is otherwise untouched.
 */
export function plainText(text: string): string {
  return text
    .replaceAll(String.fromCodePoint(0x2014), ' - ')
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
    .replace(/[ \t]+$/gm, '');
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** True for a file that counts as ground truth: parsed source, not tests, docs, or examples. */
export function isSourceFile(path: string): boolean {
  return languageOf(path) !== null && !TEST_PATH.test(path);
}

/** Line ranges on the old side of a unified diff with no context lines. */
export function oldRanges(diff: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    // A pure insertion has count 0 and sits after `start`: it touches the code around it.
    ranges.push(count === 0 ? [start, start + 1] : [start, start + count - 1]);
  }
  return ranges;
}

async function changedSymbols(
  dir: string,
  parent: string,
  commit: string,
  path: string,
): Promise<BenchTask['symbols']> {
  const lang = languageOf(path);
  if (!lang) return [];
  const source = git(dir, ['show', `${parent}:${path}`]).replace(/\r\n?/g, '\n');
  const parsed = await parseSource(lang, source);
  if (!parsed) return [];
  const ranges = oldRanges(git(dir, ['diff', '-U0', '--no-color', parent, commit, '--', path]));
  const found = new Map<string, BenchTask['symbols'][number]>();
  for (const [from, to] of ranges) {
    // The innermost symbol that overlaps the changed lines.
    const hit = parsed.symbols
      .filter((s) => s.kind !== 'constant' && s.startLine <= to && s.endLine >= from)
      .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
    if (hit) {
      found.set(hit.qualifiedName, {
        path,
        name: hit.qualifiedName,
        startLine: hit.startLine,
        endLine: hit.endLine,
      });
    }
  }
  return [...found.values()];
}

/**
 * Mines tasks from the first-parent history ending at `repo.commit`: the most recent
 * `maxTasks` commits that look like a fix or feature, touch at most eight files, and change
 * at least one existing source file. The next `maxMemories` older ones become memories.
 * Every third task, oldest first, goes to the test split.
 */
export async function mineTasks(
  dir: string,
  repo: BenchRepo,
  maxTasks = 36,
  maxMemories = 60,
): Promise<{ tasks: BenchTask[]; memories: BenchMemory[] }> {
  const log = git(dir, [
    'log',
    '--first-parent',
    '--no-merges',
    '-n',
    '3000',
    '--format=%H%x1f%P%x1f%an%x1f%B%x1e',
    repo.commit,
  ]);
  const tasks: BenchTask[] = [];
  const memories: BenchMemory[] = [];
  for (const entry of log.split('\x1e')) {
    const [sha, parents, author, body] = entry.trim().split('\x1f');
    if (!sha || !parents || !author || body === undefined) continue;
    const parent = parents.split(' ')[0] as string;
    const raw = body
      .split('\n')
      .filter((line) => !/^(co-authored-by|signed-off-by|reviewed-by|change-id):/i.test(line))
      .join('\n');
    const text = plainText(raw).trim().slice(0, 2000);
    const subject = text.split('\n')[0] ?? '';
    if (BOT.test(author) || text.length < 30 || SKIP_SUBJECT.test(subject)) continue;

    const changes = git(dir, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      '--no-renames',
      sha,
    ])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t') as [string, string]);
    if (changes.length === 0 || changes.length > MAX_FILES) continue;
    // Only files that exist in the parent can be found there.
    const files = changes
      .filter(([status, path]) => status === 'M' && isSourceFile(path))
      .map(([, path]) => path);
    if (files.length === 0) continue;

    if (tasks.length < maxTasks) {
      const symbols = (
        await Promise.all(files.map((path) => changedSymbols(dir, parent, sha, path)))
      ).flat();
      tasks.push({
        id: sha.slice(0, 10),
        repo: repo.name,
        commit: sha,
        parent,
        text,
        files,
        symbols,
        split: 'train',
      });
    } else if (memories.length < maxMemories) {
      memories.push({ id: `m_${sha.slice(0, 8)}`, text: subject, files });
    } else {
      break;
    }
  }
  tasks.reverse(); // oldest first, so consecutive checkouts differ little
  for (const [i, task] of tasks.entries()) task.split = i % 3 === 2 ? 'test' : 'train';
  return { tasks, memories };
}
