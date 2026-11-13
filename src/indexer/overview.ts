import type { Store } from '../store/index.js';
import { countTokens } from '../tokens.js';

const MAX_TOKENS = 1500;

interface Dir {
  files: number;
  /** Symbols defined directly in this directory, with how often they are referenced. */
  symbols: { name: string; references: number }[];
  children: Map<string, Dir>;
}

function render(root: Dir, depth: number, perDir: number, totals: string): string {
  const out = [totals];
  const walk = (dir: Dir, name: string, level: number): void => {
    if (level > 0) {
      const top = dir.symbols
        .sort((a, b) => b.references - a.references || a.name.localeCompare(b.name))
        .slice(0, perDir)
        .map((s) => s.name);
      const names = top.length > 0 ? `: ${top.join(', ')}` : '';
      out.push(`${'  '.repeat(level - 1)}${name}/ (${dir.files} files)${names}`);
    }
    if (level >= depth) return;
    for (const [child, sub] of [...dir.children].sort((a, b) => a[0].localeCompare(b[0]))) {
      walk(sub, child, level + 1);
    }
  };
  walk(root, '', 0);
  return out.join('\n');
}

/**
 * A compact map of the repo for agents: the directory tree to depth 3, each directory with
 * its file count (including subdirectories) and its most-referenced symbols. At most
 * 1,500 tokens: detail is reduced until it fits.
 */
export function buildOverview(store: Store): string {
  const root: Dir = { files: 0, symbols: [], children: new Map() };
  const dirFor = (path: string, count: boolean): Dir => {
    let dir = root;
    if (count) dir.files++;
    for (const part of path.split('/').slice(0, -1)) {
      let next = dir.children.get(part);
      if (!next) {
        next = { files: 0, symbols: [], children: new Map() };
        dir.children.set(part, next);
      }
      dir = next;
      if (count) dir.files++;
    }
    return dir;
  };
  const { files, symbols } = store.overviewInput();
  for (const path of files) dirFor(path, true);
  for (const s of symbols) dirFor(s.path, false).symbols.push(s);

  const counts = store.counts();
  const totals = `${counts.files} files, ${counts.symbols} symbols. Directories show their file count and most-referenced symbols.`;
  const top = root.symbols
    .sort((a, b) => b.references - a.references)
    .slice(0, 5)
    .map((s) => s.name);
  const header = top.length > 0 ? `${totals}\n(top level): ${top.join(', ')}` : totals;
  for (const [depth, perDir] of [
    [3, 5],
    [3, 3],
    [2, 3],
    [2, 1],
    [1, 1],
    [1, 0],
  ] as const) {
    const text = render(root, depth, perDir, header);
    if (countTokens(text) <= MAX_TOKENS) return text;
  }
  // A repo with a very wide top level: keep as many lines as fit.
  const lines = render(root, 1, 0, header).split('\n');
  while (lines.length > 1 && countTokens(lines.join('\n')) > MAX_TOKENS) lines.pop();
  return lines.join('\n');
}
