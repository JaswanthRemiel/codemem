// The dashboard's code graph, one folder at a time: each child folder or file of the current
// folder is a node, and resolved symbol edges between files are summed onto those nodes.

export interface GraphNode {
  /** Path from the project root: a folder (no trailing slash) or a file. */
  id: string;
  label: string;
  type: 'folder' | 'file';
  /** Files inside it (1 for a file). */
  files: number;
  symbols: number;
  /** The file's language, or the most common language inside a folder. */
  language: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface FolderView {
  dir: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** The graph of the children of `dir` ('' is the project root). */
export function folderView(
  files: { path: string; language: string | null; symbols: number }[],
  fileEdges: { src: string; dst: string; weight: number }[],
  dir: string,
): FolderView {
  const prefix = dir === '' ? '' : `${dir.replace(/\/+$/, '')}/`;
  // The child of `dir` a file belongs to, or undefined when it is outside `dir`.
  const childOf = (path: string): string | undefined => {
    if (!path.startsWith(prefix)) return undefined;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? path : prefix + rest.slice(0, slash);
  };

  const nodes = new Map<string, GraphNode & { languages: Map<string, number> }>();
  for (const file of files) {
    const id = childOf(file.path);
    if (id === undefined) continue;
    const node = nodes.get(id) ?? {
      id,
      label: id.slice(prefix.length),
      type: id === file.path ? ('file' as const) : ('folder' as const),
      files: 0,
      symbols: 0,
      language: null,
      languages: new Map<string, number>(),
    };
    node.files += 1;
    node.symbols += file.symbols;
    if (file.language)
      node.languages.set(file.language, (node.languages.get(file.language) ?? 0) + 1);
    nodes.set(id, node);
  }

  const edges = new Map<string, GraphEdge>();
  for (const edge of fileEdges) {
    const source = childOf(edge.src);
    const target = childOf(edge.dst);
    if (source === undefined || target === undefined || source === target) continue;
    const key = `${source}\n${target}`;
    const existing = edges.get(key);
    if (existing) existing.weight += edge.weight;
    else edges.set(key, { source, target, weight: edge.weight });
  }

  return {
    dir: prefix.replace(/\/$/, ''),
    nodes: [...nodes.values()]
      .map(({ languages, ...node }) => ({
        ...node,
        language: [...languages].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      }))
      // Folders first, then files, each by name.
      .sort((a, b) =>
        a.type === b.type ? a.id.localeCompare(b.id) : a.type === 'folder' ? -1 : 1,
      ),
    edges: [...edges.values()],
  };
}
