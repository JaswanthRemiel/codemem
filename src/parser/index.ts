import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, Query, type Node } from 'web-tree-sitter';
import { GrammarError } from '../errors.js';

export type Lang = 'typescript' | 'tsx' | 'javascript' | 'python' | 'go';
export type SymbolKind =
  'function' | 'method' | 'class' | 'interface' | 'type' | 'enum' | 'constant';

export interface CodeSymbol {
  name: string;
  /** Dotted path through the enclosing symbols, for example `UserService.login`. */
  qualifiedName: string;
  kind: SymbolKind;
  /** Declaration text up to the body, on one line per overload. */
  signature: string;
  docstring: string;
  /** 1-based, includes decorators and the `export` keyword. */
  startLine: number;
  endLine: number;
  /** First line of the doc comment above the symbol, or `startLine` if there is none. */
  docStartLine: number;
  /** Index of the enclosing symbol in `ParsedFile.symbols`. */
  parent: number | null;
  /** String offsets of the body, when the symbol has one. */
  body: [start: number, end: number] | null;
  /** Start lines of the statements directly inside a function body. */
  stmtLines: number[];
}

export type RefKind = 'call' | 'extends' | 'implements' | 'type';

/** A place where a symbol mentions another by name: a call, a base class, or a type. */
export interface Ref {
  kind: RefKind;
  name: string;
  /**
   * For `receiver.name()`: the text before the dot when it is a plain name or path, or an
   * empty string when it is some other expression. Null when there is no receiver.
   */
  receiver: string | null;
  line: number;
  /** Index of the innermost enclosing symbol, or null at file level. */
  from: number | null;
}

/** One name an import brings into the file. */
export interface ImportRef {
  /** The module as written: `./db`, `.payments`, `example.com/kv`. */
  source: string;
  /** The imported name, `default`, `*` for the whole module, or empty for a bare import. */
  name: string;
  /** The name used in this file. */
  local: string;
  line: number;
}

export interface ParsedFile {
  symbols: CodeSymbol[];
  refs: Ref[];
  imports: ImportRef[];
}

const EXTENSIONS: Record<string, Lang> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
};

const QUERY_FILES: Record<Lang, string[]> = {
  javascript: ['ecma', 'javascript'],
  typescript: ['ecma', 'typescript'],
  tsx: ['ecma', 'typescript'],
  python: ['python'],
  go: ['go'],
};

export const LANGS = Object.keys(QUERY_FILES) as Lang[];

const GRAMMAR_DIR = new URL('../../grammars/', import.meta.url);
/** Node types that wrap a definition and belong to it. */
const WRAPPERS = new Set(['export_statement', 'decorated_definition']);

/** The structural language for a path, or null when the file gets line windows. */
export function languageOf(path: string): Lang | null {
  return EXTENSIONS[extname(path).toLowerCase()] ?? null;
}

let init: Promise<void> | undefined;
const loaded = new Map<Lang, Promise<{ parser: Parser; query: Query }>>();

function load(lang: Lang): Promise<{ parser: Parser; query: Query }> {
  let entry = loaded.get(lang);
  if (!entry) {
    entry = (async () => {
      try {
        await (init ??= Parser.init());
        const language = await Language.load(fileURLToPath(new URL(`${lang}.wasm`, GRAMMAR_DIR)));
        const scm = await Promise.all(
          QUERY_FILES[lang].map((name) => readFile(new URL(`${name}.scm`, GRAMMAR_DIR), 'utf8')),
        );
        const parser = new Parser();
        parser.setLanguage(language);
        return { parser, query: new Query(language, scm.join('\n')) };
      } catch (cause) {
        throw new GrammarError(`Grammar for ${lang} failed to load; run \`remimem doctor\``, {
          cause,
        });
      }
    })();
    loaded.set(lang, entry);
  }
  return entry;
}

/** Parses one file and extracts its symbols, call sites, and imports. */
export async function parseSource(lang: Lang, source: string): Promise<ParsedFile | null> {
  const { parser, query } = await load(lang);
  const tree = parser.parse(source);
  if (!tree) return null;
  try {
    return extract(lang, source, tree.rootNode, query);
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}

interface Draft extends CodeSymbol {
  from: number;
  to: number;
  pattern: number;
  overload: boolean;
  receiver: string | null;
  parentRef: Draft | null;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 300);

function cleanComment(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(\/\*+|\/\/+|#+|\*(?!\/))\s?/, '').replace(/\s*\*+\/\s*$/, ''))
    .join('\n')
    .trim();
}

function buildDraft(
  lang: Lang,
  source: string,
  lines: string[],
  kind: string,
  node: Node,
  name: string,
  body: Node | undefined,
  receiver: string | null,
  pattern: number,
): Draft {
  let outer = node;
  while (outer.parent && WRAPPERS.has(outer.parent.type)) outer = outer.parent;
  // TypeScript method decorators are siblings that come before the method.
  let start = outer;
  for (let p = start.previousNamedSibling; p?.type === 'decorator'; p = p.previousNamedSibling) {
    start = p;
  }

  const comments: string[] = [];
  let docStartRow = start.startPosition.row;
  for (
    let p = start.previousNamedSibling;
    p?.type === 'comment' &&
    p.endPosition.row >= docStartRow - 1 &&
    (lines[p.startPosition.row] ?? '').slice(0, p.startPosition.column).trim() === '';
    p = p.previousNamedSibling
  ) {
    comments.unshift(p.text);
    docStartRow = p.startPosition.row;
  }
  let docstring = cleanComment(comments.join('\n'));
  if (lang === 'python' && body) {
    const first = body.namedChild(0);
    const str = first?.type === 'expression_statement' ? first.namedChild(0) : null;
    if (str?.type === 'string') {
      docstring = str.text
        .replace(/^[a-zA-Z]*("""|'''|"|')/, '')
        .replace(/("""|'''|"|')$/, '')
        .trim();
    }
  }

  let block = body;
  const only = block?.namedChildCount === 1 ? block.namedChild(0) : null;
  if (only?.type === 'statement_list') block = only; // Go wraps statements in a list node
  const isCallable = kind === 'function' || kind === 'method';

  return {
    name,
    qualifiedName: name,
    kind: (kind === 'overload' ? 'function' : kind) as SymbolKind,
    signature: body
      ? collapse(
          source
            .slice(start.startIndex, body.startIndex)
            .split('\n')
            .filter((line) => !line.trimStart().startsWith(lang === 'python' ? '#' : '//'))
            .join('\n'),
        )
      : collapse(lines[start.startPosition.row] ?? ''),
    docstring,
    startLine: start.startPosition.row + 1,
    endLine: outer.endPosition.row + 1,
    docStartLine: docStartRow + 1,
    parent: null,
    body: body ? [body.startIndex, body.endIndex] : null,
    stmtLines: isCallable && block ? block.namedChildren.map((n) => n.startPosition.row + 1) : [],
    from: start.startIndex,
    to: outer.endIndex,
    pattern,
    overload: kind === 'overload',
    receiver,
    parentRef: null,
  };
}

function extract(lang: Lang, source: string, root: Node, query: Query): ParsedFile {
  const lines = source.split('\n');
  const drafts = new Map<number, Draft>();
  const rawRefs = new Map<number, Omit<Ref, 'from'> & { index: number }>();
  const importSources = new Map<number, { source: string; line: number }>();
  const bindings: { node: number; source?: string; name: string; local: string }[] = [];

  for (const match of query.matches(root)) {
    const caps = new Map(match.captures.map((c) => [c.name, c.node]));
    const defKey = [...caps.keys()].find((key) => key.startsWith('def.'));
    const nameNode = caps.get('name');
    const imp = caps.get('import');

    if (defKey && nameNode) {
      const existing = drafts.get(nameNode.id);
      if (existing && existing.pattern <= match.patternIndex) continue;
      const node = caps.get(defKey) as Node;
      drafts.set(
        nameNode.id,
        buildDraft(
          lang,
          source,
          lines,
          defKey.slice(4),
          node,
          nameNode.text,
          caps.get('body'),
          caps.get('receiver')?.text ?? null,
          match.patternIndex,
        ),
      );
    } else if (imp) {
      const src = caps.get('source')?.text;
      const alias = caps.get('ialias')?.text;
      const module = caps.get('imodule')?.text;
      const named = caps.get('iname')?.text;
      const fallback = caps.get('idefault') ?? caps.get('inamespace');
      if (src) importSources.set(imp.id, { source: src, line: imp.startPosition.row + 1 });
      if (module) {
        const local = alias ?? (lang === 'go' ? (module.split('/').at(-1) ?? module) : module);
        bindings.push({ node: imp.id, source: module, name: '*', local });
      } else if (named) {
        bindings.push({ node: imp.id, source: src, name: named, local: alias ?? named });
      } else if (fallback) {
        const name = caps.has('idefault') ? 'default' : '*';
        bindings.push({ node: imp.id, source: src, name, local: fallback.text });
      }
      if (!importSources.has(imp.id)) {
        importSources.set(imp.id, { source: module ?? '', line: imp.startPosition.row + 1 });
      }
    } else {
      const refKey = [...caps.keys()].find((key) => key.startsWith('ref.'));
      const node = caps.get('callee') ?? (refKey ? caps.get(refKey) : undefined);
      if (!node || rawRefs.has(node.id)) continue; // earlier patterns win
      const recv = caps.get('recv')?.text;
      rawRefs.set(node.id, {
        kind: refKey ? (refKey.slice(4) as RefKind) : 'call',
        name: node.text,
        receiver: recv === undefined ? null : /^[\w.$]+$/.test(recv) ? recv : '',
        line: node.startPosition.row + 1,
        index: node.startIndex,
      });
    }
  }
  // A definition's own name is not a reference to it.
  for (const id of drafts.keys()) rawRefs.delete(id);

  const sorted = [...drafts.values()].sort((a, b) => a.from - b.from || b.to - a.to);
  const stack: Draft[] = [];
  for (const d of sorted) {
    while (stack.length > 0 && (stack.at(-1) as Draft).to <= d.from) stack.pop();
    d.parentRef = stack.at(-1) ?? null;
    stack.push(d);
  }
  for (const d of sorted) {
    if (d.receiver) {
      // Go methods live outside their type; attach them when the type is in this file.
      d.parentRef = sorted.find((s) => s !== d && !s.parentRef && s.name === d.receiver) ?? null;
      d.qualifiedName = `${d.receiver}.${d.name}`;
    } else if (d.parentRef) {
      d.qualifiedName = `${d.parentRef.qualifiedName}.${d.name}`;
    }
    if (d.kind === 'function' && d.parentRef?.kind === 'class') d.kind = 'method';
  }

  // Fold overload signatures into the implementation that follows; drop the rest.
  const symbols: Draft[] = [];
  let pending: Draft[] = [];
  for (const d of sorted) {
    if (d.overload) {
      pending.push(d);
      continue;
    }
    const mine = pending.filter((o) => o.name === d.name && o.parentRef === d.parentRef);
    const first = mine[0];
    if (first && d.body) {
      d.signature = [...mine.map((o) => o.signature), d.signature].join('\n');
      d.docstring ||= first.docstring;
      d.startLine = first.startLine;
      d.docStartLine = first.docStartLine;
      d.from = first.from;
    }
    pending = [];
    symbols.push(d);
  }

  const indexOf = new Map(symbols.map((s, i) => [s, i]));
  const callerOf = (index: number): number | null => {
    let found: number | null = null;
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i] as Draft;
      if (s.from > index) break;
      if (index < s.to) found = i; // later matches are nested deeper
    }
    return found;
  };

  const imports: ImportRef[] = [];
  const bound = new Set<number>();
  for (const b of bindings) {
    const statement = importSources.get(b.node);
    bound.add(b.node);
    imports.push({
      source: b.source ?? statement?.source ?? '',
      name: b.name,
      local: b.local,
      line: statement?.line ?? 0,
    });
  }
  for (const [node, { source: module, line }] of importSources) {
    if (!bound.has(node)) imports.push({ source: module, name: '', local: '', line });
  }

  // One type reference per symbol and name is enough.
  const seenTypes = new Set<string>();
  const refs: Ref[] = [];
  for (const { index, ...ref } of [...rawRefs.values()].sort((a, b) => a.index - b.index)) {
    const from = callerOf(index);
    if (ref.kind === 'type') {
      const key = `${from}:${ref.name}`;
      if (seenTypes.has(key)) continue;
      seenTypes.add(key);
    }
    refs.push({ ...ref, from });
  }

  return {
    symbols: symbols.map((d) => ({
      name: d.name,
      qualifiedName: d.qualifiedName,
      kind: d.kind,
      signature: d.signature,
      docstring: d.docstring,
      startLine: d.startLine,
      endLine: d.endLine,
      docStartLine: d.docStartLine,
      parent: d.parentRef ? (indexOf.get(d.parentRef) ?? null) : null,
      body: d.body,
      stmtLines: d.stmtLines,
    })),
    refs,
    imports: imports.sort((a, b) => a.line - b.line),
  };
}
