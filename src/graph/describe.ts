import { render } from '../packer/index.js';
import type { Neighbor, Store, SymbolRow } from '../store/index.js';

/** Section titles for each relation, in display order. */
const SECTIONS: [relation: string, title: string][] = [
  ['calls', 'Calls'],
  ['calls by', 'Called by'],
  ['extends', 'Extends'],
  ['extends by', 'Extended by'],
  ['implements', 'Implements'],
  ['implements by', 'Implemented by'],
  ['uses-type', 'Uses types'],
  ['uses-type by', 'Used as a type by'],
  ['inside', 'Inside'],
  ['contains', 'Contains'],
];

const location = (s: SymbolRow): string => `${s.path}:${s.startLine}-${s.endLine}`;

/** The symbols a name refers to: an exact qualified name wins over plain name matches. */
function lookup(store: Store, name: string): SymbolRow[] {
  const matches = store.symbolsNamed(name);
  const qualified = matches.filter((s) => s.qualifiedName === name);
  return qualified.length > 0 ? qualified : matches;
}

/**
 * A symbol with its neighbors, as text for an agent. `depth` is how many hops of callers
 * and callees to follow (0 to 2); other relations are listed for the symbol itself.
 */
export function describeSymbol(
  store: Store,
  name: string,
  options: { include?: 'signature' | 'body'; depth?: number } = {},
): string {
  const matches = lookup(store, name);
  const symbol = matches[0];
  if (!symbol) return `No symbol named "${name}" in the index.`;
  if (matches.length > 1) {
    const list = matches.map((s) => `  ${s.kind} ${s.qualifiedName}  ${location(s)}`);
    return `${matches.length} symbols are named "${name}". Ask again with a qualified name:\n${list.join('\n')}`;
  }

  const depth = Math.max(0, Math.min(2, Math.trunc(options.depth ?? 1)));
  const chunks = store.chunksOfSymbol(symbol.id);
  const body =
    options.include === 'signature' || chunks.length === 0
      ? `--- ${location(symbol)} ${symbol.kind} ${symbol.qualifiedName}\n${symbol.signature}${symbol.docstring ? `\n${symbol.docstring.replace(/^/gm, '  ')}` : ''}`
      : render(
          chunks.map((chunk) => ({ chunk, score: 0, reasons: [], detail: 'full' as const })),
        ).replaceAll(' []', '');
  if (depth === 0) return body;

  const out = [body];
  const direct = store.neighbors([symbol.id]);
  for (const [relation, title] of SECTIONS) {
    const rows = direct.filter((n) => n.relation === relation);
    if (rows.length === 0) continue;
    out.push('', `${title}:`);
    const follow = relation === 'calls' || relation === 'calls by';
    const seen = new Set([symbol.id]);
    const walk = (level: Neighbor[], hop: number): void => {
      for (const n of level) {
        const again = seen.has(n.id);
        seen.add(n.id);
        out.push(
          `${'  '.repeat(hop)}${n.qualifiedName}  ${location(n)}  [${n.confidence}]${again ? ' (shown above)' : ''}`,
        );
        if (follow && !again && hop < depth) {
          walk(
            store.neighbors([n.id]).filter((next) => next.relation === relation),
            hop + 1,
          );
        }
      }
    };
    walk(rows, 1);
  }
  return out.join('\n');
}

/** Every place a symbol is called, extended, used as a type, or imported, grouped by file. */
export function findReferences(store: Store, name: string): string {
  const matches = lookup(store, name);
  if (matches.length === 0) return `No symbol named "${name}" in the index.`;
  const references = store.referencesTo(matches.map((s) => s.id));
  const defined = matches.map((s) => `${s.kind} ${s.qualifiedName} at ${location(s)}`).join('; ');
  if (references.length === 0) return `No references found to ${defined}.`;

  const paths = new Set(references.map((r) => r.path));
  const out = [
    `${references.length} reference${references.length === 1 ? '' : 's'} in ${paths.size} file${paths.size === 1 ? '' : 's'} to ${defined}`,
  ];
  let current = '';
  for (const r of references) {
    if (r.path !== current) {
      current = r.path;
      out.push('', r.path);
    }
    const what =
      r.kind === 'import'
        ? 'import'
        : `${r.kind} in ${r.fromSymbol ?? 'file scope'} [${r.confidence}]`;
    out.push(`  ${r.path}:${r.line}  ${what}`);
  }
  return out.join('\n');
}
