// The dashboard page. Plain DOM: every value from the index or from memories is added as text
// (never as HTML), because memories can arrive through git from other people.
import cytoscape from 'cytoscape';

// ---------------------------------------------------------------- API

const TOKEN_KEY = 'remimem-token';
const token = ((): string => {
  const fromUrl = new URLSearchParams(location.search).get('token');
  try {
    if (fromUrl) sessionStorage.setItem(TOKEN_KEY, fromUrl);
    return fromUrl ?? sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return fromUrl ?? '';
  }
})();

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const write = method !== 'GET';
  const res = await fetch(path, {
    method,
    headers: {
      'x-remimem-token': token,
      ...(write ? { 'content-type': 'application/json' } : {}),
    },
    ...(write ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const data = (await res.json().catch(() => ({ error: res.statusText }))) as T & {
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

// ---------------------------------------------------------------- Types the API returns

interface Overview {
  root: string;
  version: string;
  counts: { files: number; symbols: number; chunks: number; edges: number; vectors: number };
  embeddingModel: string | null;
  lastIndexedAt: string | null;
  lastIndexedCommit: string | null;
  languages: { language: string; files: number }[];
  memories: { total: number; stale: number };
  pending: { changed: number; added: number; deleted: number } | null;
  indexing: boolean;
}

interface Stats {
  byTool: {
    tool: string;
    queries: number;
    tokensReturned: number;
    baselineTokens: number;
    meanLatencyMs: number;
  }[];
  daily: { day: string; queries: number; tokensReturned: number; baselineTokens: number }[];
}

interface GraphNode {
  id: string;
  label: string;
  type: 'folder' | 'file';
  files: number;
  symbols: number;
  language: string | null;
}

interface FileInfo {
  path: string;
  language: string | null;
  symbols: {
    id: number;
    name: string;
    qualifiedName: string;
    kind: string;
    signature: string;
    docstring: string;
    startLine: number;
    endLine: number;
    parentId: number | null;
    neighbors: {
      id: number;
      path: string;
      name: string;
      kind: string;
      line: number;
      relation: string;
      confidence: string;
    }[];
  }[];
  memories: Memory[];
}

interface Memory {
  id: string;
  kind: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  stale: boolean;
  links: { path: string; symbol: string | null }[];
}

interface SearchAnswer {
  ms: number;
  tokens: number;
  budget: number;
  text: string;
  results: {
    path: string;
    startLine: number;
    endLine: number;
    symbol: string | null;
    kind: string;
    score: number;
    reasons: string[];
    detail: 'full' | 'signature';
    tokens: number;
    included: boolean;
  }[];
}

// ---------------------------------------------------------------- DOM helpers

type Child = Node | string | number | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'class') el.className = String(value);
    else if (key === 'value') (el as HTMLInputElement).value = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const n = (value: number): string => value.toLocaleString('en-US');

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

let toastTimer: number | undefined;
function toast(message: string): void {
  const el = document.getElementById('toast') as HTMLElement;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 4000);
}

/** Runs an action from a button, disabling it meanwhile and reporting failures. */
async function busy(button: HTMLButtonElement, run: () => Promise<void>): Promise<void> {
  button.disabled = true;
  try {
    await run();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  } finally {
    button.disabled = false;
  }
}

const css = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const PALETTE = ['#c08a3e', '#6f9a5a', '#4f8a9a', '#b5603c', '#8a6fb0', '#a89a4a', '#5f7fb5'];
const languageColors = new Map<string, string>();
function languageColor(language: string | null): string {
  if (!language) return css('--muted-fg');
  if (!languageColors.has(language)) {
    languageColors.set(language, PALETTE[languageColors.size % PALETTE.length] as string);
  }
  return languageColors.get(language) as string;
}

// ---------------------------------------------------------------- Health

function stat(value: string, label: string, note?: string): HTMLElement {
  return h(
    'div',
    { class: 'card stat' },
    h('div', { class: 'value' }, value),
    h('div', { class: 'label' }, label),
    note ? h('div', { class: 'label' }, note) : null,
  );
}

/** Tokens returned against the read-whole-files baseline, one pair of bars per day. */
function savingsChart(daily: Stats['daily']): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const days = daily.slice(-30);
  const width = 600;
  const height = 160;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Tokens per day: read whole files compared with remimem');
  const max = Math.max(1, ...days.map((d) => d.baselineTokens));
  // Bars stay narrow when there are only a few days, and grow left to right.
  const slot = Math.min(width / Math.max(days.length, 1), 48);
  days.forEach((d, i) => {
    for (const [value, color, offset] of [
      [d.baselineTokens, css('--muted'), 0],
      [d.tokensReturned, css('--primary'), 0.5],
    ] as const) {
      const rect = document.createElementNS(NS, 'rect');
      const barHeight = Math.max(1, (value / max) * (height - 20));
      rect.setAttribute('x', String(i * slot + slot * (0.1 + offset * 0.8)));
      rect.setAttribute('y', String(height - 16 - barHeight));
      rect.setAttribute('width', String(slot * 0.38));
      rect.setAttribute('height', String(barHeight));
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', color);
      const title = document.createElementNS(NS, 'title');
      title.textContent = `${d.day}: ${n(value)} tokens`;
      rect.append(title);
      svg.append(rect);
    }
  });
  for (const [i, d] of [
    [0, days[0]],
    [days.length - 1, days[days.length - 1]],
  ] as const) {
    if (!d) continue;
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(i * slot + (i === 0 ? 2 : slot - 2)));
    label.setAttribute('y', String(height - 2));
    label.setAttribute('font-size', '11');
    label.setAttribute('text-anchor', i === 0 ? 'start' : 'end');
    label.setAttribute('fill', css('--muted-fg'));
    label.textContent = d.day;
    svg.append(label);
  }
  return svg;
}

async function health(main: HTMLElement): Promise<void> {
  const [o, stats] = await Promise.all([api<Overview>('/api/overview'), api<Stats>('/api/stats')]);
  main.append(
    h('h1', {}, 'Health'),
    h(
      'p',
      { class: 'lede' },
      'What the index holds, what it saved your agent, and whether the setup works.',
    ),
  );
  if (o.counts.files === 0) {
    main.append(
      h(
        'div',
        { class: 'card' },
        'The index is empty. Run ',
        h('code', {}, 'remimem init'),
        ' in the project.',
      ),
    );
    return;
  }
  const embedded = o.counts.chunks ? Math.round((o.counts.vectors / o.counts.chunks) * 100) : 0;
  main.append(
    h(
      'div',
      { class: 'grid' },
      stat(n(o.counts.files), 'files'),
      stat(n(o.counts.symbols), 'symbols'),
      stat(n(o.counts.edges), 'resolved edges'),
      stat(n(o.counts.chunks), 'chunks'),
      stat(
        o.embeddingModel ? `${embedded}%` : 'off',
        'embedded',
        o.embeddingModel ?? 'keyword search only',
      ),
      stat(
        n(o.memories.total),
        'memories',
        o.memories.stale ? `${o.memories.stale} stale` : undefined,
      ),
    ),
  );

  // Index freshness, with the buttons to bring it up to date.
  const pending = o.pending ? o.pending.changed + o.pending.added + o.pending.deleted : 0;
  const reindex = (full: boolean): HTMLButtonElement => {
    const button = h(
      'button',
      { class: full ? 'btn' : 'btn primary', type: 'button' },
      full ? 'Full re-index' : 'Re-index',
    );
    button.addEventListener('click', () =>
      busy(button, async () => {
        button.textContent = 'Indexing...';
        const { stats: s } = await api<{
          stats: { indexed: number; deleted: number; seconds: number };
        }>('/api/index', 'POST', { full });
        toast(
          `Indexed ${n(s.indexed)} files, removed ${n(s.deleted)}, in ${s.seconds.toFixed(1)} s.`,
        );
        void route();
      }),
    );
    return button;
  };
  main.append(
    h('h2', {}, 'Index'),
    h(
      'div',
      { class: 'card row' },
      h(
        'div',
        {},
        h(
          'div',
          {},
          `Last indexed ${ago(o.lastIndexedAt)}`,
          o.lastIndexedCommit
            ? h('span', { class: 'muted mono' }, ` at ${o.lastIndexedCommit.slice(0, 10)}`)
            : null,
        ),
        h(
          'div',
          { class: 'muted' },
          o.indexing
            ? 'Indexing now...'
            : pending
              ? `${o.pending?.changed} changed, ${o.pending?.added} new, ${o.pending?.deleted} deleted since then`
              : 'Up to date with the files on disk',
        ),
      ),
      h('span', { class: 'spacer' }),
      reindex(false),
      reindex(true),
    ),
  );

  // Savings, from the query log of the agent's tool calls.
  const returned = stats.byTool.reduce((sum, t) => sum + t.tokensReturned, 0);
  const baseline = stats.byTool.reduce((sum, t) => sum + t.baselineTokens, 0);
  const queries = stats.byTool.reduce((sum, t) => sum + t.queries, 0);
  main.append(h('h2', {}, 'Savings'));
  if (queries === 0) {
    main.append(
      h(
        'div',
        { class: 'card muted' },
        'No tool calls yet. Savings appear once your agent uses remimem.',
      ),
    );
  } else {
    const saved = baseline ? Math.round((1 - returned / baseline) * 100) : 0;
    main.append(
      h(
        'div',
        { class: 'grid' },
        stat(`${saved}%`, 'fewer tokens than reading whole files'),
        stat(n(baseline - returned), 'tokens saved'),
        stat(n(queries), 'tool calls'),
      ),
      h(
        'div',
        { class: 'card', style: 'margin-top:12px' },
        savingsChart(stats.daily),
        h(
          'div',
          { class: 'legend' },
          h('span', {}, h('i', { style: `background:${css('--muted')}` }), 'read whole files'),
          h('span', {}, h('i', { style: `background:${css('--primary')}` }), 'remimem'),
        ),
      ),
      h(
        'div',
        { class: 'card table-wrap', style: 'margin-top:12px' },
        h(
          'table',
          {},
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', {}, 'Tool'),
              h('th', {}, 'Calls'),
              h('th', {}, 'Tokens returned'),
              h('th', {}, 'Baseline'),
              h('th', {}, 'Mean latency'),
            ),
          ),
          h(
            'tbody',
            {},
            ...stats.byTool.map((t) =>
              h(
                'tr',
                {},
                h('td', { class: 'mono' }, t.tool),
                h('td', {}, n(t.queries)),
                h('td', {}, n(t.tokensReturned)),
                h('td', {}, n(t.baselineTokens)),
                h('td', {}, `${t.meanLatencyMs} ms`),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // Languages by file count.
  const most = Math.max(...o.languages.map((l) => l.files));
  main.append(
    h('h2', {}, 'Languages'),
    h(
      'div',
      { class: 'card' },
      ...o.languages.map((l) =>
        h(
          'div',
          { class: 'row', style: 'margin:4px 0' },
          h('span', { class: 'mono', style: 'width:110px' }, l.language),
          h(
            'div',
            { class: 'bar', style: 'flex:1' },
            h('span', {
              style: `width:${(l.files / most) * 100}%;background:${languageColor(l.language)}`,
            }),
          ),
          h('span', { class: 'muted', style: 'width:70px;text-align:right' }, n(l.files)),
        ),
      ),
    ),
  );

  // Doctor runs on request: checking the embedding model can take a few seconds.
  const results = h('div', {});
  const run = h('button', { class: 'btn', type: 'button' }, 'Run checks');
  run.addEventListener('click', () =>
    busy(run, async () => {
      const { lines, ok } = await api<{ lines: string[]; ok: boolean }>('/api/doctor');
      results.replaceChildren(
        h(
          'p',
          {},
          h(
            'span',
            { class: `chip ${ok ? 'ok' : 'bad'}` },
            ok ? 'all checks pass' : 'a check failed',
          ),
        ),
        ...lines.map((line) => h('div', { class: 'mono' }, line)),
      );
    }),
  );
  main.append(
    h('h2', {}, 'Setup checks'),
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'muted' }, 'The same checks as remimem doctor.'),
        h('span', { class: 'spacer' }),
        run,
      ),
      results,
    ),
  );
}

// ---------------------------------------------------------------- Graph

const graphState = { dir: '', file: '', textFiles: false };
let cy: cytoscape.Core | undefined;

async function graph(main: HTMLElement): Promise<void> {
  const view = await api<{
    dir: string;
    nodes: GraphNode[];
    edges: { source: string; target: string; weight: number }[];
  }>(`/api/graph?dir=${encodeURIComponent(graphState.dir)}`);
  // Files that are not parsed as code (docs, config, data) have no edges; hidden by default.
  const hidden = view.nodes.filter(
    (node) => node.type === 'file' && node.symbols === 0 && node.language === null,
  );
  if (!graphState.textFiles) {
    const gone = new Set(hidden.map((node) => node.id));
    view.nodes = view.nodes.filter((node) => !gone.has(node.id));
    view.edges = view.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target));
  }
  main.append(
    h('h1', {}, 'Code graph'),
    h(
      'p',
      { class: 'lede' },
      'Folders and files, linked by the calls and type uses between them. Click a folder to open it, a file to see its symbols.',
    ),
  );

  // Breadcrumbs: the project root, then each folder down to the current one.
  const crumbs = h('div', { class: 'crumbs' });
  const parts = view.dir ? view.dir.split('/') : [];
  const go = (dir: string) => () => {
    graphState.dir = dir;
    graphState.file = '';
    void route();
  };
  crumbs.append(h('button', { type: 'button', onclick: go('') }, 'root'));
  parts.forEach((part, i) => {
    crumbs.append(
      '/',
      h('button', { type: 'button', onclick: go(parts.slice(0, i + 1).join('/')) }, part),
    );
  });
  if (hidden.length) {
    const toggle = h('input', {
      type: 'checkbox',
      id: 'text-files',
      checked: graphState.textFiles,
    });
    toggle.addEventListener('change', () => {
      graphState.textFiles = toggle.checked;
      void route();
    });
    crumbs.append(
      h('span', { class: 'spacer' }),
      h(
        'label',
        { for: 'text-files', class: 'row muted', style: 'gap:4px;font-family:var(--sans)' },
        toggle,
        `show ${hidden.length} non-code files`,
      ),
    );
  }

  const canvas = h('div', {
    id: 'cy',
    role: 'img',
    'aria-label': `Graph of ${view.dir || 'the project root'}`,
  });
  const panel = h(
    'div',
    { class: 'card panel' },
    h(
      'p',
      { class: 'muted' },
      'Select a file to see its symbols, their callers and callees, and linked memories.',
    ),
  );
  const languages = [
    ...new Set(view.nodes.map((node) => node.language).filter((l): l is string => l !== null)),
  ];
  main.append(
    crumbs,
    h(
      'div',
      { class: 'graph-layout' },
      h(
        'div',
        {},
        canvas,
        h(
          'div',
          { class: 'legend' },
          h('span', {}, 'square: folder, circle: file, size: symbols, line: calls between them'),
          ...languages.map((l) =>
            h('span', {}, h('i', { style: `background:${languageColor(l)}` }), l),
          ),
        ),
      ),
      panel,
    ),
  );

  if (view.nodes.length === 0) {
    canvas.replaceChildren(
      h('p', { class: 'muted', style: 'padding:16px' }, 'Nothing indexed here.'),
    );
    return;
  }
  cy?.destroy();
  const maxWeight = Math.max(1, ...view.edges.map((e) => e.weight));
  cy = cytoscape({
    container: canvas,
    minZoom: 0.2,
    maxZoom: 1.5,
    elements: [
      ...view.nodes.map((node) => ({
        data: {
          id: node.id,
          label: node.type === 'folder' ? `${node.label}/` : node.label,
          type: node.type,
          size: Math.min(70, 16 + Math.sqrt(node.symbols) * 4),
          color: languageColor(node.language),
        },
      })),
      ...view.edges.map((e) => ({
        data: {
          id: `${e.source}>${e.target}`,
          source: e.source,
          target: e.target,
          width: 1 + (Math.log(1 + e.weight) / Math.log(1 + maxWeight)) * 5,
        },
      })),
    ],
    style: [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          width: 'data(size)',
          height: 'data(size)',
          label: 'data(label)',
          color: css('--fg'),
          'font-size': 11,
          'font-family': 'ui-monospace, Menlo, Consolas, monospace',
          'text-valign': 'bottom',
          'text-margin-y': 4,
          'text-background-color': css('--card'),
          'text-background-opacity': 0.8,
          'text-background-padding': '2px',
        },
      },
      {
        selector: 'node[type = "folder"]',
        style: { shape: 'round-rectangle', 'border-width': 2, 'border-color': css('--primary') },
      },
      { selector: 'node:selected', style: { 'border-width': 3, 'border-color': css('--fg') } },
      {
        selector: 'edge',
        style: {
          width: 'data(width)',
          'line-color': css('--border'),
          'target-arrow-color': css('--border'),
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 0.8,
        },
      },
      { selector: '.faded', style: { opacity: 0.15 } },
      {
        selector: 'edge.lit',
        style: { 'line-color': css('--primary'), 'target-arrow-color': css('--primary') },
      },
    ],
    layout:
      view.nodes.length > 150
        ? {
            name: 'concentric',
            concentric: (node: cytoscape.NodeSingular) => Number(node.data('size')),
            minNodeSpacing: 12,
          }
        : {
            name: 'cose',
            animate: false,
            nodeDimensionsIncludeLabels: true,
            componentSpacing: 60,
            nodeRepulsion: () => 12000,
            idealEdgeLength: () => 90,
            padding: 24,
          },
  });
  cy.on('mouseover', 'node', (event) => {
    const around = (event.target as cytoscape.NodeSingular).closedNeighborhood();
    cy?.elements().addClass('faded');
    around.removeClass('faded');
    around.edges().addClass('lit');
  });
  cy.on('mouseout', 'node', () => cy?.elements().removeClass('faded lit'));
  cy.on('tap', 'node', (event) => {
    const data = (event.target as cytoscape.NodeSingular).data() as { id: string; type: string };
    if (data.type === 'folder') go(data.id)();
    else {
      graphState.file = data.id;
      void showFile(panel, data.id);
    }
  });
  if (graphState.file) {
    cy.getElementById(graphState.file).select();
    void showFile(panel, graphState.file);
  }
}

/** Opens a file in the graph: goes to its folder and shows its symbols. */
function openFile(path: string): void {
  graphState.dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  graphState.file = path;
  if (location.hash === '#graph') void route();
  else location.hash = '#graph';
}

async function showFile(panel: HTMLElement, path: string): Promise<void> {
  panel.replaceChildren(h('p', { class: 'muted' }, 'Loading...'));
  const file = await api<FileInfo>(`/api/file?path=${encodeURIComponent(path)}`);
  const depth = new Map<number, number>();
  panel.replaceChildren(
    h('h2', { style: 'margin-top:0', class: 'mono' }, file.path),
    h('p', { class: 'muted' }, `${file.language ?? 'text'}, ${file.symbols.length} symbols`),
  );
  if (file.memories.length) {
    panel.append(
      h('h3', {}, 'Memories about this file'),
      ...file.memories.map((m) =>
        h(
          'div',
          { class: 'card memory', style: 'margin-bottom:6px' },
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'chip' }, m.kind),
            m.stale ? h('span', { class: 'chip stale' }, 'stale') : null,
          ),
          h('p', {}, m.text),
        ),
      ),
    );
  }
  for (const s of file.symbols) {
    const level = s.parentId === null ? 0 : (depth.get(s.parentId) ?? 0) + 1;
    depth.set(s.id, level);
    const code = h('div', {});
    const title = h(
      'button',
      { type: 'button', title: 'Show the code' },
      h('span', { class: 'chip' }, s.kind),
      ' ',
      h('strong', { class: 'mono' }, s.name),
      h('span', { class: 'muted mono' }, ` ${s.startLine}-${s.endLine}`),
    );
    title.addEventListener('click', () => {
      if (code.childElementCount) return code.replaceChildren();
      void api<{ code: string }>(`/api/symbol?id=${s.id}`)
        .then(({ code: text }) =>
          code.replaceChildren(h('pre', { class: 'code', style: 'margin-top:6px' }, text)),
        )
        .catch((error: unknown) => toast(String(error)));
    });
    panel.append(
      h(
        'div',
        { class: 'symbol', style: `padding-left:${level * 14}px` },
        title,
        s.neighbors.length
          ? h(
              'ul',
              { class: 'neighbors' },
              ...s.neighbors.map((nb) =>
                h(
                  'li',
                  {},
                  h('span', { class: 'muted', style: 'min-width:92px' }, nb.relation),
                  h('span', { class: `chip ${nb.confidence}` }, nb.confidence),
                  h(
                    'button',
                    {
                      type: 'button',
                      title: `${nb.path}:${nb.line}`,
                      onclick: () => openFile(nb.path),
                    },
                    nb.path === file.path ? nb.name : `${nb.name} (${nb.path})`,
                  ),
                ),
              ),
            )
          : null,
        code,
      ),
    );
  }
}

// ---------------------------------------------------------------- Search

let lastQuery = { query: '', budget: '', k: '' };

async function searchView(main: HTMLElement): Promise<void> {
  const query = h('input', {
    type: 'search',
    placeholder: 'how are requests authenticated',
    value: lastQuery.query,
    style: 'flex:1;min-width:200px',
    'aria-label': 'Query',
  });
  const budget = h('input', {
    type: 'number',
    min: '200',
    step: '100',
    placeholder: 'budget',
    value: lastQuery.budget,
    style: 'width:110px',
    'aria-label': 'Token budget',
  });
  const k = h('input', {
    type: 'number',
    min: '1',
    max: '100',
    placeholder: 'results',
    value: lastQuery.k,
    style: 'width:90px',
    'aria-label': 'Number of results',
  });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Search');
  const out = h('div', {});
  const form = h('form', { class: 'row' }, query, budget, k, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    lastQuery = { query: query.value, budget: budget.value, k: k.value };
    void busy(submit, async () => {
      const answer = await api<SearchAnswer>('/api/search', 'POST', {
        query: query.value,
        ...(budget.value ? { budget: Number(budget.value) } : {}),
        ...(k.value ? { k: Number(k.value) } : {}),
      });
      out.replaceChildren(...renderAnswer(answer));
    });
  });
  main.append(
    h('h1', {}, 'Search playground'),
    h(
      'p',
      { class: 'lede' },
      'The same search and packing your agent gets, with the score and the reason for every result. Queries here are not counted in the savings.',
    ),
    form,
    out,
  );
  query.focus();
  if (lastQuery.query) form.requestSubmit();
}

function renderAnswer(answer: SearchAnswer): Node[] {
  const share = Math.min(100, (answer.tokens / answer.budget) * 100);
  return [
    h(
      'div',
      { class: 'card', style: 'margin-top:14px' },
      h(
        'div',
        { class: 'row' },
        h('span', {}, `${answer.results.length} results in ${answer.ms} ms`),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted' }, `${n(answer.tokens)} of ${n(answer.budget)} tokens used`),
      ),
      h('div', { class: 'bar', style: 'margin-top:8px' }, h('span', { style: `width:${share}%` })),
    ),
    h(
      'div',
      { class: 'card table-wrap', style: 'margin-top:12px' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, '#'),
            h('th', {}, 'Score'),
            h('th', {}, 'Where'),
            h('th', {}, 'Why'),
            h('th', {}, 'Packed'),
          ),
        ),
        h(
          'tbody',
          {},
          ...answer.results.map((r, i) =>
            h(
              'tr',
              {},
              h('td', { class: 'muted' }, i + 1),
              h('td', { class: 'mono' }, r.score.toFixed(3)),
              h(
                'td',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'mono',
                    style:
                      'border:0;background:none;padding:0;color:var(--primary);cursor:pointer;text-align:left',
                    onclick: () => openFile(r.path),
                  },
                  `${r.path}:${r.startLine}-${r.endLine}`,
                ),
                h('div', { class: 'muted' }, r.symbol ? `${r.kind} ${r.symbol}` : r.kind),
              ),
              h(
                'td',
                {},
                h(
                  'div',
                  { class: 'row', style: 'gap:4px' },
                  ...r.reasons.map((reason) => h('span', { class: 'chip' }, reason)),
                ),
              ),
              h(
                'td',
                {},
                h(
                  'span',
                  { class: `chip ${r.included ? 'ok' : ''}` },
                  r.included ? (r.detail === 'full' ? 'full' : 'signature') : 'over budget',
                ),
                h('div', { class: 'muted' }, `${n(r.tokens)} tok`),
              ),
            ),
          ),
        ),
      ),
    ),
    h('h2', {}, 'What the agent receives'),
    h('pre', { class: 'code' }, answer.text),
  ];
}

// ---------------------------------------------------------------- Memory

const memoryState = { kind: '', text: '', staleOnly: false };

function memoryForm(
  kinds: string[],
  memory: Memory | undefined,
  done: () => void,
): HTMLFormElement {
  const text = h(
    'textarea',
    { rows: 3, required: true, 'aria-label': 'Memory text' },
    memory?.text ?? '',
  );
  const kind = h(
    'select',
    { 'aria-label': 'Kind' },
    ...kinds.map((k) => h('option', { value: k, selected: k === (memory?.kind ?? 'decision') }, k)),
  );
  const list = (values: string[]): string => values.join(', ');
  const paths = h('input', {
    type: 'text',
    placeholder: 'src/billing/invoice.ts',
    value: list(memory?.links.filter((l) => !l.symbol).map((l) => l.path) ?? []),
  });
  const symbols = h('input', {
    type: 'text',
    placeholder: 'Invoice.total',
    value: list(memory?.links.flatMap((l) => (l.symbol ? [l.symbol] : [])) ?? []),
  });
  const tags = h('input', {
    type: 'text',
    placeholder: 'billing, money',
    value: list(memory?.tags ?? []),
  });
  const save = h('button', { class: 'btn primary', type: 'submit' }, memory ? 'Save' : 'Remember');
  const cancel = h('button', { class: 'btn', type: 'button', onclick: done }, 'Cancel');
  const split = (value: string): string[] =>
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  const form = h(
    'form',
    { class: 'card form' },
    h('label', {}, 'What should be remembered', text),
    h(
      'div',
      { class: 'row' },
      h('label', {}, 'Kind', kind),
      h('label', { style: 'flex:1' }, 'Files (comma separated)', paths),
      h('label', { style: 'flex:1' }, 'Symbols', symbols),
      h('label', { style: 'flex:1' }, 'Tags', tags),
    ),
    h('div', { class: 'row' }, save, cancel),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void busy(save, async () => {
      const body = {
        text: text.value,
        kind: kind.value,
        paths: split(paths.value),
        symbols: split(symbols.value),
        tags: split(tags.value),
      };
      const result = await api<{ unlinked: string[] }>(
        memory ? `/api/memories/${memory.id}` : '/api/memories',
        memory ? 'PUT' : 'POST',
        body,
      );
      toast(result.unlinked.length ? `Saved. Not linked: ${result.unlinked.join('; ')}` : 'Saved.');
      done();
    });
  });
  return form;
}

async function memoryView(main: HTMLElement): Promise<void> {
  const { kinds, memories } = await api<{ kinds: string[]; memories: Memory[] }>('/api/memories');
  const list = h('div', { class: 'memory' });
  const formSlot = h('div', { style: 'margin:12px 0' });
  const kind = h(
    'select',
    { 'aria-label': 'Filter by kind' },
    h('option', { value: '' }, 'every kind'),
    ...kinds.map((k) => h('option', { value: k, selected: k === memoryState.kind }, k)),
  );
  const text = h('input', {
    type: 'search',
    placeholder: 'filter',
    value: memoryState.text,
    'aria-label': 'Filter memories',
  });
  const stale = h('input', { type: 'checkbox', checked: memoryState.staleOnly, id: 'stale-only' });
  const add = h('button', { class: 'btn primary', type: 'button' }, 'Add memory');
  const reload = (): void => void route();
  add.addEventListener('click', () =>
    formSlot.replaceChildren(memoryForm(kinds, undefined, reload)),
  );

  const draw = (): void => {
    memoryState.kind = kind.value;
    memoryState.text = text.value;
    memoryState.staleOnly = stale.checked;
    const needle = text.value.toLowerCase();
    const shown = memories.filter(
      (m) =>
        (!kind.value || m.kind === kind.value) &&
        (!stale.checked || m.stale) &&
        (!needle ||
          `${m.text} ${m.tags.join(' ')} ${m.links.map((l) => l.path).join(' ')}`
            .toLowerCase()
            .includes(needle)),
    );
    list.replaceChildren(
      ...(shown.length
        ? shown.map((m) => {
            const card = h('div', { class: 'card memory' });
            const edit = h('button', { class: 'btn', type: 'button' }, 'Edit');
            const remove = h('button', { class: 'btn danger', type: 'button' }, 'Forget');
            edit.addEventListener('click', () => card.replaceWith(memoryForm(kinds, m, reload)));
            remove.addEventListener('click', () => {
              if (!confirm(`Forget this memory?\n\n${m.text}`)) return;
              void busy(remove, async () => {
                await api(`/api/memories/${m.id}`, 'DELETE');
                toast('Forgotten.');
                reload();
              });
            });
            card.append(
              h(
                'div',
                { class: 'row' },
                h('span', { class: 'chip' }, m.kind),
                m.stale
                  ? h(
                      'span',
                      {
                        class: 'chip stale',
                        title: 'The linked code changed after this was written',
                      },
                      'stale',
                    )
                  : null,
                h('span', { class: 'muted mono' }, m.id),
                h('span', { class: 'muted' }, `updated ${ago(m.updatedAt)}`),
                h('span', { class: 'spacer' }),
                edit,
                remove,
              ),
              h('p', {}, m.text),
              m.tags.length || m.links.length
                ? h(
                    'div',
                    { class: 'row', style: 'gap:4px' },
                    ...m.tags.map((t) => h('span', { class: 'chip' }, `#${t}`)),
                    ...m.links.map((l) =>
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'chip mono',
                          style: 'cursor:pointer;background:none',
                          onclick: () => openFile(l.path),
                        },
                        l.symbol ? `${l.path} ${l.symbol}` : l.path,
                      ),
                    ),
                  )
                : '',
            );
            return card;
          })
        : [
            h(
              'div',
              { class: 'card muted' },
              memories.length
                ? 'No memory matches the filter.'
                : 'No memories yet. Your agent saves them with the remember tool, or add one here.',
            ),
          ]),
    );
  };
  kind.addEventListener('change', draw);
  text.addEventListener('input', draw);
  stale.addEventListener('change', draw);

  const staleCount = memories.filter((m) => m.stale).length;
  main.append(
    h('h1', {}, 'Project memory'),
    h(
      'p',
      { class: 'lede' },
      `${memories.length} decisions, conventions, gotchas, and todos${staleCount ? `, ${staleCount} stale because their code changed` : ''}. Kept in .remimem/memory.json, so they can be shared through git.`,
    ),
    h(
      'div',
      { class: 'row' },
      kind,
      text,
      h('label', { class: 'row', for: 'stale-only', style: 'gap:4px' }, stale, 'stale only'),
      h('span', { class: 'spacer' }),
      add,
    ),
    formSlot,
    list,
  );
  draw();
}

// ---------------------------------------------------------------- Settings

async function settings(main: HTMLElement): Promise<void> {
  const { raw, effective } = await api<{ raw: unknown; effective: unknown }>('/api/config');
  const editor = h(
    'textarea',
    { rows: 16, spellcheck: 'false', 'aria-label': '.remimem/config.json' },
    JSON.stringify(raw, null, 2),
  );
  const message = h('div', {});
  const effectiveView = h('pre', { class: 'code' }, JSON.stringify(effective, null, 2));
  const save = h('button', { class: 'btn primary', type: 'button' }, 'Save');
  save.addEventListener('click', () =>
    busy(save, async () => {
      message.replaceChildren();
      let config: unknown;
      try {
        config = JSON.parse(editor.value);
      } catch (error) {
        message.replaceChildren(h('p', { class: 'error' }, `Not valid JSON: ${String(error)}`));
        return;
      }
      try {
        const result = await api<{ effective: unknown; needsFullIndex: boolean }>(
          '/api/config',
          'PUT',
          { config },
        );
        effectiveView.textContent = JSON.stringify(result.effective, null, 2);
        toast('Saved. The server uses the new settings now.');
        if (result.needsFullIndex) {
          const full = h('button', { class: 'btn primary', type: 'button' }, 'Full re-index now');
          full.addEventListener('click', () =>
            busy(full, async () => {
              await api('/api/index', 'POST', { full: true });
              toast('Re-indexed with the new embedding settings.');
            }),
          );
          message.replaceChildren(
            h(
              'div',
              { class: 'card row' },
              'The embedding settings changed, so the vectors must be rebuilt.',
              h('span', { class: 'spacer' }),
              full,
            ),
          );
        }
      } catch (error) {
        message.replaceChildren(
          h('p', { class: 'error' }, error instanceof Error ? error.message : String(error)),
        );
      }
    }),
  );
  main.append(
    h('h1', {}, 'Settings'),
    h(
      'p',
      { class: 'lede' },
      'Edits .remimem/config.json. Only what differs from the defaults needs to be there. Every change is checked before it is saved.',
    ),
    editor,
    message,
    h(
      'div',
      { class: 'row', style: 'margin-top:10px' },
      save,
      h('button', { class: 'btn', type: 'button', onclick: () => void route() }, 'Discard changes'),
    ),
    h('h2', {}, 'Effective settings'),
    h(
      'p',
      { class: 'lede' },
      'Your file with every default filled in. See the configuration reference for what each field does.',
    ),
    effectiveView,
  );
}

// ---------------------------------------------------------------- Router

const VIEWS: Record<string, (main: HTMLElement) => Promise<void>> = {
  health,
  graph,
  search: searchView,
  memory: memoryView,
  settings,
};

let generation = 0;
async function route(): Promise<void> {
  const name = location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'health';
  const mine = ++generation;
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.tabs a')) {
    if (link.dataset['view'] === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const main = document.getElementById('main') as HTMLElement;
  // Attached before it is filled: the graph measures its container to lay itself out. A view
  // replaced by a newer navigation keeps filling a detached element, which is harmless.
  const next = h('div', {});
  main.replaceChildren(next);
  try {
    await (VIEWS[name] as (main: HTMLElement) => Promise<void>)(next);
  } catch (error) {
    if (mine !== generation) return;
    next.replaceChildren(
      h('h1', {}, 'Something went wrong'),
      h('p', { class: 'error' }, error instanceof Error ? error.message : String(error)),
    );
  }
}

window.addEventListener('hashchange', () => void route());
void api<Overview>('/api/overview')
  .then((o) => {
    const root = document.getElementById('root') as HTMLElement;
    root.textContent = o.root;
    root.title = o.root;
    (document.getElementById('version') as HTMLElement).textContent = `v${o.version}`;
    document.title = `${o.root.split(/[\\/]/).pop() ?? 'remimem'} - remimem`;
  })
  .catch(() => undefined);
void route();
