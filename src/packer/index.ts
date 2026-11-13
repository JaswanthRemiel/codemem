import type { ChunkRow } from '../store/index.js';
import { countTokens } from '../tokens.js';

export interface PackItem {
  chunk: ChunkRow;
  score: number;
  reasons: string[];
  /** `signature` shows only the signature and docstring, with the location to fetch the body. */
  detail: 'full' | 'signature';
}

export interface PackResult {
  /** The context for the agent, ending with a one-line footer. Never more than the budget. */
  text: string;
  /** Approximate tokens in `text`. */
  tokens: number;
  included: PackItem[];
  dropped: PackItem[];
}

interface Block {
  path: string;
  startLine: number;
  endLine: number;
  labels: string[];
  reasons: string[];
  body: string;
  score: number;
  signatureOnly: boolean;
}

/** Tokens set aside for the footer line so that adding it cannot break the budget. */
const FOOTER_RESERVE = 24;

const label = (chunk: ChunkRow): string =>
  chunk.symbol ? `${chunk.kind} ${chunk.symbol}` : 'lines';

/**
 * The source lines of a chunk. A later part of a split function carries its signature as
 * extra leading lines, which are dropped here so parts can be joined back together.
 */
function rawLines(chunk: ChunkRow): string[] {
  const lines = chunk.content.split('\n');
  const extra = lines.length - (chunk.endLine - chunk.startLine + 1);
  return extra > 0 ? lines.slice(extra) : lines;
}

function toBlock(item: PackItem): Block {
  const { chunk } = item;
  const signatureOnly = item.detail === 'signature' && chunk.signature !== '';
  const doc = chunk.docstring ? `\n${chunk.docstring.replace(/^/gm, '  ')}` : '';
  return {
    path: chunk.path,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    labels: [label(chunk)],
    reasons: [...item.reasons],
    body: signatureOnly ? `${chunk.signature}${doc}` : chunk.content,
    score: item.score,
    signatureOnly,
  };
}

/**
 * Blocks for the chosen items: grouped by file, in line order, with overlapping or adjacent
 * chunks of a file joined into one block. Class headers and signature-only blocks stand
 * alone because their text is not a plain slice of the file.
 */
function buildBlocks(items: PackItem[]): Block[] {
  const byPath = new Map<string, PackItem[]>();
  for (const item of items) {
    byPath.set(item.chunk.path, [...(byPath.get(item.chunk.path) ?? []), item]);
  }
  const files = [...byPath.values()].sort(
    (a, b) => Math.max(...b.map((i) => i.score)) - Math.max(...a.map((i) => i.score)),
  );

  const blocks: Block[] = [];
  for (const fileItems of files) {
    const fileBlocks: Block[] = [];
    let open: (Block & { lines: string[] }) | null = null;
    const sorted = [...fileItems].sort(
      (a, b) => a.chunk.startLine - b.chunk.startLine || b.chunk.endLine - a.chunk.endLine,
    );
    for (const item of sorted) {
      const { chunk } = item;
      const mergeable =
        chunk.kind !== 'class' && !(item.detail === 'signature' && chunk.signature !== '');
      if (!mergeable) {
        fileBlocks.push(toBlock(item));
        continue;
      }
      if (open && chunk.startLine <= open.endLine + 1) {
        // Keep only the lines the open block does not already have.
        open.lines.push(...rawLines(chunk).slice(Math.max(0, open.endLine + 1 - chunk.startLine)));
        open.endLine = Math.max(open.endLine, chunk.endLine);
        if (!open.labels.includes(label(chunk))) open.labels.push(label(chunk));
        open.reasons = [...new Set([...open.reasons, ...item.reasons])];
        open.score = Math.max(open.score, item.score);
      } else {
        // The first chunk of a block keeps its content as stored, signature prefix included.
        open = { ...toBlock(item), lines: chunk.content.split('\n') };
        fileBlocks.push(open);
      }
    }
    for (const block of fileBlocks) {
      if ('lines' in block) block.body = (block.lines as string[]).join('\n');
    }
    blocks.push(...fileBlocks.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine));
  }
  return blocks;
}

function renderBlock(block: Block): string {
  const note = block.signatureOnly ? ' (signature only)' : '';
  return `--- ${block.path}:${block.startLine}-${block.endLine} ${block.labels.join(', ')} [${block.reasons.join(', ')}]${note}\n${block.body}`;
}

const render = (items: PackItem[]): string => buildBlocks(items).map(renderBlock).join('\n\n');

function footer(tokens: number, results: number, dropped: number): string {
  const drop = dropped > 0 ? ` | ${dropped} dropped for budget` : '';
  return `~${tokens.toLocaleString('en-US')} tokens | ${results} result${results === 1 ? '' : 's'}${drop}`;
}

/**
 * Fits ranked items into `budget` tokens. Items are taken in score order; one that does not
 * fit in full is tried as signature-only before it is dropped. The returned text never
 * exceeds the budget.
 */
export function pack(candidates: PackItem[], budget: number): PackResult {
  const seen = new Set<number>();
  const items = [...candidates]
    .sort((a, b) => b.score - a.score)
    .filter((item) => !seen.has(item.chunk.id) && seen.add(item.chunk.id));

  const bodyBudget = budget - FOOTER_RESERVE;
  const included: PackItem[] = [];
  const dropped: PackItem[] = [];
  let estimate = 0;
  for (const item of items) {
    // Per-item cost is an estimate (joining blocks changes it slightly); the loop below
    // measures the real text.
    const forms: PackItem[] =
      item.detail === 'full' && item.chunk.signature
        ? [item, { ...item, detail: 'signature' }]
        : [item];
    const fitting = forms
      .map((form) => ({ form, cost: countTokens(renderBlock(toBlock(form))) + 2 }))
      .find(({ cost }) => estimate + cost <= bodyBudget);
    if (fitting) {
      included.push(fitting.form);
      estimate += fitting.cost;
    } else {
      dropped.push(item);
    }
  }

  let body = render(included);
  let tokens = countTokens(body);
  while (included.length > 0 && tokens > bodyBudget) {
    dropped.push(included.pop() as PackItem);
    body = render(included);
    tokens = countTokens(body);
  }

  // The footer states the size of the whole text, itself included.
  let text = '';
  let total = tokens + FOOTER_RESERVE;
  for (let i = 0; i < 4; i++) {
    text = `${body}${body ? '\n\n' : ''}${footer(total, included.length, dropped.length)}`;
    const actual = countTokens(text);
    if (actual === total) break;
    total = actual;
  }
  if (countTokens(text) > budget) return { text: '', tokens: 0, included: [], dropped: items };
  return { text, tokens: countTokens(text), included, dropped };
}
