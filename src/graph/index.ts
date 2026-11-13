import { posix } from 'node:path';
import type { GraphInput, Store } from '../store/index.js';

export type Confidence = 'exact' | 'import' | 'name-match';

type Sym = GraphInput['symbols'][number];
type Import = GraphInput['imports'][number];
type Hit = { target: number; confidence: Confidence } | null;

export interface Resolution {
  refs: { id: number; target: number; confidence: Confidence }[];
  imports: { id: number; target: number }[];
}

/** Languages that can refer to each other's symbols. */
const FAMILY: Record<string, string> = {
  typescript: 'ecma',
  tsx: 'ecma',
  javascript: 'ecma',
  python: 'python',
  go: 'go',
};
const ECMA_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const TYPE_KINDS = new Set(['class', 'interface', 'type', 'enum']);
const SELF = new Set(['this', 'self', 'cls']);

const dirOf = (path: string): string => {
  const dir = posix.dirname(path);
  return dir === '.' ? '' : dir;
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Resolves every reference and import to the symbol it most likely means. Best effort, in
 * this order: the same file (`exact`), a name the file imports (`import`), then a name that
 * is unique in the repo (`name-match`). A call through an import that leads outside the
 * repo, such as `fmt.Println`, is left unresolved instead of guessed.
 */
export function resolveReferences(input: GraphInput): Resolution {
  const files = new Map(input.files.map((f) => [f.id, { ...f, dir: dirOf(f.path) }]));
  const fileIdByPath = new Map(input.files.map((f) => [f.path, f.id]));
  const filesByDir = new Map<string, number[]>();
  for (const f of files.values()) push(filesByDir, f.dir, f.id);
  const familyOf = (fileId: number): string => FAMILY[files.get(fileId)?.language ?? ''] ?? '';

  const symbols = new Map(input.symbols.map((s) => [s.id, s]));
  const inFile = new Map<string, Sym[]>(); // "fileId:name", every symbol
  const topLevel = new Map<string, Sym[]>(); // "fileId:name", symbols without a parent
  const children = new Map<number, Sym[]>();
  const byName = new Map<string, Sym[]>();
  const byQualified = new Map<string, Sym>(); // "dir:qualifiedName"
  for (const s of input.symbols) {
    push(inFile, `${s.fileId}:${s.name}`, s);
    if (s.parentId === null) push(topLevel, `${s.fileId}:${s.name}`, s);
    else push(children, s.parentId, s);
    push(byName, s.name, s);
    byQualified.set(`${files.get(s.fileId)?.dir}:${s.qualifiedName}`, s);
  }
  const locals = new Map<string, Import>(); // "fileId:localName"
  for (const i of input.imports) if (i.local) locals.set(`${i.fileId}:${i.local}`, i);

  const moduleCache = new Map<string, number[]>();
  /** The repo files an import source refers to; empty when it leads outside the repo. */
  const moduleFiles = (fileId: number, source: string): number[] => {
    const file = files.get(fileId);
    if (!file || !source) return [];
    const family = familyOf(fileId);
    const key = `${family}|${source.startsWith('.') ? file.dir : ''}|${source}`;
    let found = moduleCache.get(key);
    if (!found) {
      found = findModule(family, file.dir, source);
      moduleCache.set(key, found);
    }
    return found;
  };

  const existing = (paths: string[]): number[] => {
    const id = paths.map((p) => fileIdByPath.get(p)).find((x) => x !== undefined);
    return id === undefined ? [] : [id];
  };
  /** The one file of a family whose path ends with one of the given paths. */
  const bySuffix = (family: string, endings: string[]): number[] => {
    const hits = input.files.filter(
      (f) =>
        FAMILY[f.language ?? ''] === family &&
        endings.some((end) => f.path === end || f.path.endsWith(`/${end}`)),
    );
    return hits.length === 1 ? [(hits[0] as { id: number }).id] : [];
  };

  function findModule(family: string, dir: string, source: string): number[] {
    if (family === 'ecma') {
      const bare = source.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/, '');
      const endings = (base: string): string[] =>
        ECMA_EXTENSIONS.flatMap((ext) => [`${base}${ext}`, `${base}/index${ext}`]);
      return source.startsWith('.')
        ? existing(endings(posix.normalize(posix.join(dir, bare))))
        : bySuffix(family, endings(bare.replace(/^[@~]\//, '')));
    }
    if (family === 'python') {
      const dots = /^\.*/.exec(source)?.[0].length ?? 0;
      const rest = source.slice(dots).split('.').filter(Boolean).join('/');
      if (dots === 0) return bySuffix(family, [`${rest}.py`, `${rest}/__init__.py`]);
      let base = dir;
      for (let i = 1; i < dots; i++) base = dirOf(base);
      const target = posix.join(base, rest);
      return existing(rest ? [`${target}.py`, `${target}/__init__.py`] : [`${target}/__init__.py`]);
    }
    if (family === 'go') {
      for (const { dir: root, module } of input.goModules) {
        if (source !== module && !source.startsWith(`${module}/`)) continue;
        const packageDir = posix.join(root, source.slice(module.length + 1));
        return (filesByDir.get(packageDir === '.' ? '' : packageDir) ?? []).filter(
          (id) => familyOf(id) === 'go',
        );
      }
    }
    return [];
  }

  const kindOk = (s: Sym, refKind: string): boolean => refKind === 'call' || TYPE_KINDS.has(s.kind);
  const topIn = (fileIds: number[], name: string, refKind = 'call'): Sym | undefined => {
    for (const id of fileIds) {
      const hit = topLevel.get(`${id}:${name}`)?.find((s) => kindOk(s, refKind));
      if (hit) return hit;
    }
    return undefined;
  };
  /** A member of a class or struct. Go methods can live in another file of the package. */
  const member = (owner: Sym, name: string): Sym | undefined =>
    children.get(owner.id)?.find((s) => s.name === name) ??
    byQualified.get(`${files.get(owner.fileId)?.dir}:${owner.qualifiedName}.${name}`);
  const hit = (s: Sym | undefined, confidence: Confidence): Hit =>
    s ? { target: s.id, confidence } : null;

  function resolve(ref: GraphInput['refs'][number]): Hit {
    const { fileId, name, receiver, kind } = ref;
    const caller = ref.symbolId === null ? undefined : symbols.get(ref.symbolId);
    const family = familyOf(fileId);

    if (receiver === null) {
      // Enclosing functions, innermost first, then the top level of the file.
      for (let s = caller; s; s = s.parentId === null ? undefined : symbols.get(s.parentId)) {
        if (s.kind === 'class') continue;
        const nested = children.get(s.id)?.find((c) => c.name === name && kindOk(c, kind));
        if (nested) return hit(nested, 'exact');
      }
      const sameFile = topIn([fileId], name, kind);
      if (sameFile) return hit(sameFile, 'exact');
      if (family === 'go') {
        // A Go package is a directory: its files share one scope.
        const samePackage = topIn(filesByDir.get(files.get(fileId)?.dir ?? '') ?? [], name, kind);
        if (samePackage) return hit(samePackage, 'exact');
      }
      const imported = locals.get(`${fileId}:${name}`);
      if (imported) {
        if (imported.name === '*') return null;
        const original = imported.name === 'default' ? name : imported.name;
        return hit(topIn(moduleFiles(fileId, imported.source), original, kind), 'import');
      }
    } else if (SELF.has(receiver)) {
      let owner = caller;
      while (owner && owner.kind !== 'class') {
        owner = owner.parentId === null ? undefined : symbols.get(owner.parentId);
      }
      const own = owner && member(owner, name);
      if (own) return hit(own, 'exact');
    } else if (receiver !== '') {
      const imported =
        locals.get(`${fileId}:${receiver}`) ?? locals.get(`${fileId}:${receiver.split('.')[0]}`);
      if (imported) {
        const targets = moduleFiles(fileId, imported.source);
        if (imported.name === '*') return hit(topIn(targets, name), 'import');
        // The receiver is an imported class, or (Python) an imported submodule.
        const owner = topIn(targets, imported.name === 'default' ? imported.local : imported.name);
        if (owner) return hit(member(owner, name), 'import');
        const separator = imported.source.endsWith('.') ? '' : '.';
        const submodule =
          family === 'python'
            ? moduleFiles(fileId, `${imported.source}${separator}${imported.name}`)
            : [];
        return hit(topIn(submodule, name), 'import');
      }
      const owner = topIn([fileId], receiver);
      const own = owner && TYPE_KINDS.has(owner.kind) ? member(owner, name) : undefined;
      if (own) return hit(own, 'exact');
    }

    if (receiver !== null) {
      // The receiver is a value of unknown type: one symbol of that name in this file.
      const sameFile = (inFile.get(`${fileId}:${name}`) ?? []).filter((s) => kindOk(s, kind));
      if (sameFile.length === 1) return hit(sameFile[0], 'exact');
    }

    const candidates = (byName.get(name) ?? []).filter((s) => {
      const parent = s.parentId === null ? undefined : symbols.get(s.parentId);
      return (
        familyOf(s.fileId) === family &&
        kindOk(s, kind) &&
        s.kind !== 'constant' &&
        // A function nested in another function cannot be reached from elsewhere.
        (!parent || parent.kind === 'class')
      );
    });
    return candidates.length === 1 ? hit(candidates[0], 'name-match') : null;
  }

  const refs: Resolution['refs'] = [];
  for (const ref of input.refs) {
    const resolved = resolve(ref);
    if (resolved) refs.push({ id: ref.id, ...resolved });
  }
  const imports: Resolution['imports'] = [];
  for (const i of input.imports) {
    if (i.name === '' || i.name === '*') continue;
    const target = topIn(moduleFiles(i.fileId, i.source), i.name === 'default' ? i.local : i.name);
    if (target) imports.push({ id: i.id, target: target.id });
  }
  return { refs, imports };
}

/** Resolves every reference in the store again and rebuilds the edges. */
export function updateGraph(store: Store): { edges: number } {
  const { refs, imports } = resolveReferences(store.graphInput());
  store.saveResolution(refs, imports);
  return { edges: store.edgeCount() };
}
