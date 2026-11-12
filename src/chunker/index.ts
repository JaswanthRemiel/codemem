import { createHash } from 'node:crypto';
import type { CodeSymbol, Lang, ParsedFile, SymbolKind } from '../parser/index.js';

export interface Chunk {
  path: string;
  language: Lang | null;
  /** Qualified symbol name, or null for line-window chunks. */
  symbol: string | null;
  kind: SymbolKind | 'window';
  signature: string;
  docstring: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** Qualified name of the enclosing symbol. */
  parent: string | null;
  content: string;
  contentHash: string;
}

export interface ChunkOptions {
  /** Symbols longer than this are split at statement boundaries. */
  maxChunkLines: number;
  windowLines: number;
  windowOverlap: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChunkLines: 80,
  windowLines: 60,
  windowOverlap: 10,
};

// shortcut: class header chunks are never split, even for a class with hundreds of fields.
// Split them if such headers start crowding out other results.
/** Kinds that get their own chunk. Constants stay in the line windows around them. */
const CHUNKED = new Set<SymbolKind>(['function', 'method', 'class', 'interface', 'type', 'enum']);

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Line ranges of `windowLines` with `windowOverlap` shared lines, covering `from` to `to`. */
export function windows(from: number, to: number, opts: ChunkOptions): [number, number][] {
  const out: [number, number][] = [];
  const step = Math.max(1, opts.windowLines - opts.windowOverlap);
  for (let start = from; start <= to; start += step) {
    const end = Math.min(start + opts.windowLines - 1, to);
    out.push([start, end]);
    if (end === to) break;
  }
  return out;
}

/**
 * Splits `from..to` before statements so each part stays within `max` lines where possible.
 * A single statement longer than `max` stays whole here; `chunkFile` cuts it by line count.
 */
export function splitAtStatements(
  from: number,
  to: number,
  stmtLines: number[],
  max: number,
): [number, number][] {
  const parts: [number, number][] = [];
  let partStart = from;
  for (let i = 1; i < stmtLines.length; i++) {
    const next = stmtLines[i] as number;
    const afterNext = stmtLines[i + 1] ?? to + 1;
    if (afterNext - partStart > max && next > partStart) {
      parts.push([partStart, next - 1]);
      partStart = next;
    }
  }
  parts.push([partStart, to]);
  return parts;
}

/** Turns one file into chunks. `source` must use LF line endings. */
export function chunkFile(
  path: string,
  language: Lang | null,
  source: string,
  parsed: ParsedFile | null,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Chunk[] {
  const lines = source.split('\n');
  if (lines.at(-1) === '') lines.pop(); // trailing newline
  const text = (from: number, to: number): string => lines.slice(from - 1, to).join('\n');
  const chunks: Chunk[] = [];
  const add = (
    range: [number, number],
    content: string,
    sym: CodeSymbol | null,
    parent: string | null,
  ): void => {
    chunks.push({
      path,
      language,
      symbol: sym?.qualifiedName ?? null,
      kind: sym?.kind ?? 'window',
      signature: sym?.signature ?? '',
      docstring: sym?.docstring ?? '',
      startLine: range[0],
      endLine: range[1],
      parent,
      content,
      contentHash: hash(content),
    });
  };

  const covered = new Array<boolean>(lines.length + 2).fill(false);
  const symbols = parsed?.symbols ?? [];
  for (const [index, sym] of symbols.entries()) {
    const parent = sym.parent === null ? null : (symbols[sym.parent] as CodeSymbol);
    // Symbols nested in a function stay inside that function's chunk.
    if (!CHUNKED.has(sym.kind) || (parent && parent.kind !== 'class')) continue;
    const from = sym.docStartLine;
    const to = Math.min(sym.endLine, lines.length);
    const parentName = parent?.qualifiedName ?? null;
    for (let line = from; line <= to; line++) covered[line] = true;

    if (sym.kind === 'class') {
      add([from, to], classHeader(lines, language, from, to, symbols, index), sym, parentName);
    } else if (to - from + 1 > opts.maxChunkLines) {
      const parts = splitAtStatements(from, to, sym.stmtLines, opts.maxChunkLines).flatMap(
        // A single statement can still be too long: cut it into plain line blocks.
        ([a, b]) => windows(a, b, { ...opts, windowLines: opts.maxChunkLines, windowOverlap: 0 }),
      );
      for (const [i, part] of parts.entries()) {
        const body = text(part[0], part[1]);
        add(part, i === 0 ? body : `${sym.signature}\n${body}`, sym, parentName);
      }
    } else {
      add([from, to], text(from, to), sym, parentName);
    }
  }

  // Everything no symbol chunk covers (imports, constants, top-level code, or the whole
  // file for unsupported languages) becomes line windows.
  for (let line = 1; line <= lines.length; line++) {
    if (covered[line] || (lines[line - 1] as string).trim() === '') continue;
    let end = line;
    for (let next = line + 1; next <= lines.length && !covered[next]; next++) {
      if ((lines[next - 1] as string).trim() !== '') end = next;
    }
    // A run with no word characters is leftover punctuation, such as a closing bracket.
    if (/\w/.test(text(line, end))) {
      for (const range of windows(line, end, opts))
        add(range, text(range[0], range[1]), null, null);
    }
    line = end;
  }

  return chunks.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
}

/** The class text with the bodies of its own methods replaced by a placeholder. */
function classHeader(
  lines: string[],
  language: Lang | null,
  from: number,
  to: number,
  symbols: CodeSymbol[],
  classIndex: number,
): string {
  let offset = 0;
  for (let i = 0; i < from - 1; i++) offset += (lines[i] as string).length + 1;
  let header = lines.slice(from - 1, to).join('\n');
  const placeholder = language === 'python' ? '...' : '{ ... }';
  const bodies = symbols
    .filter((s) => s.parent === classIndex && s.kind === 'method' && s.body)
    .map((s) => s.body as [number, number])
    // Go methods are declared outside the type, so their bodies are not in this text.
    .filter(([start, end]) => start >= offset && end <= offset + header.length)
    .sort((a, b) => b[0] - a[0]);
  for (const [start, end] of bodies) {
    header = header.slice(0, start - offset) + placeholder + header.slice(end - offset);
  }
  return header;
}
