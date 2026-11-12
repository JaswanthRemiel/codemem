import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  chunkFile,
  DEFAULT_CHUNK_OPTIONS,
  splitAtStatements,
  windows,
} from '../src/chunker/index.js';
import { processFile } from '../src/indexer/index.js';
import { parseSource } from '../src/parser/index.js';

test('windows are 60 lines with a 10-line overlap and cover the whole range', () => {
  expect(windows(1, 82, DEFAULT_CHUNK_OPTIONS)).toEqual([
    [1, 60],
    [51, 82],
  ]);
  expect(windows(1, 60, DEFAULT_CHUNK_OPTIONS)).toEqual([[1, 60]]);
  expect(windows(5, 130, DEFAULT_CHUNK_OPTIONS)).toEqual([
    [5, 64],
    [55, 114],
    [105, 130],
  ]);
});

test('splitAtStatements cuts only at statement starts and keeps every line once', () => {
  // A 100-line function whose statements start every 10 lines from line 2.
  const stmts = [2, 12, 22, 32, 42, 52, 62, 72, 82, 92];
  const parts = splitAtStatements(1, 100, stmts, 40);
  expect(parts).toEqual([
    [1, 31],
    [32, 71],
    [72, 100],
  ]);
  for (const [start] of parts.slice(1)) expect(stmts).toContain(start);
  // One statement longer than the limit stays whole.
  expect(splitAtStatements(1, 100, [2, 95], 40)).toEqual([
    [1, 94],
    [95, 100],
  ]);
});

test('an unsupported file type falls back to overlapping line windows', async () => {
  const { chunks, parsed } = await processFile('test/fixtures/ts-app', 'db/schema.sql');
  expect(parsed).toBeNull();
  expect(chunks.map((c) => [c.kind, c.startLine, c.endLine])).toEqual([
    ['window', 1, 60],
    ['window', 51, 82],
  ]);
  expect(chunks[0]?.language).toBeNull();
});

test('an oversized function is split at statements with the signature repeated', async () => {
  const { chunks } = await processFile('test/fixtures/py-pkg', 'shop/orders.py');
  const parts = chunks.filter((c) => c.symbol === 'validate_order');
  expect(parts.length).toBeGreaterThan(1);
  for (const part of parts) {
    expect(part.endLine - part.startLine + 1).toBeLessThanOrEqual(
      DEFAULT_CHUNK_OPTIONS.maxChunkLines,
    );
    expect(part.content.split('\n')[0]).toBe('def validate_order(data):');
  }
  // The parts tile the function: no gap and no overlap.
  expect(parts[0]?.startLine).toBe(68);
  expect(parts.at(-1)?.endLine).toBe(164);
  for (let i = 1; i < parts.length; i++) {
    expect(parts[i]?.startLine).toBe((parts[i - 1]?.endLine ?? 0) + 1);
  }
});

test('no symbol chunk exceeds the limit, even when one statement is longer than it', async () => {
  const body = Array.from({ length: 200 }, (_, i) => `    step(${i});`).join('\n');
  const source = `export function big() {\n  while (true) {\n${body}\n  }\n}\n`;
  const chunks = chunkFile('big.ts', 'typescript', source, await parseSource('typescript', source));
  expect(chunks.length).toBeGreaterThan(2);
  for (const c of chunks) {
    expect(c.symbol).toBe('big');
    expect(c.endLine - c.startLine + 1).toBeLessThanOrEqual(DEFAULT_CHUNK_OPTIONS.maxChunkLines);
  }
  expect(chunks.at(-1)?.endLine).toBe(204);
});

test('a class becomes a header chunk without method bodies, plus one chunk per method', async () => {
  const { chunks } = await processFile('test/fixtures/ts-app', 'src/service.ts');
  const header = chunks.find((c) => c.symbol === 'UserService');
  expect(header?.content).toContain('private attempts = new Map<string, number>();');
  expect(header?.content).toContain(
    'async login(id: string, password: string): Promise<boolean> { ... }',
  );
  expect(header?.content).not.toContain('authenticateUser');
  const login = chunks.find((c) => c.symbol === 'UserService.login');
  expect(login?.parent).toBe('UserService');
  expect(login?.content).toContain("@Log('login')");
  expect(login?.content).toContain('await authenticateUser(id, password)');

  const py = await processFile('test/fixtures/py-pkg', 'shop/orders.py');
  const order = py.chunks.find((c) => c.symbol === 'Order');
  expect(order?.content).toContain('def validate_sku(sku):\n        ...');
  expect(order?.content).not.toContain('isalnum');
});

test('nested functions stay inside the chunk of their outer function', async () => {
  const { chunks } = await processFile('test/fixtures/py-pkg', 'shop/orders.py');
  expect(chunks.some((c) => c.symbol === 'retry.decorator')).toBe(false);
  expect(chunks.find((c) => c.symbol === 'retry')?.content).toContain(
    'def wrapper(*args, **kwargs):',
  );
});

test('every non-blank line of a file lands in at least one chunk', async () => {
  for (const [root, path] of [
    ['test/fixtures/ts-app', 'src/service.ts'],
    ['test/fixtures/ts-app', 'src/legacy.js'],
    ['test/fixtures/py-pkg', 'shop/orders.py'],
    ['test/fixtures/go-mod', 'cmd/kv/main.go'],
  ] as const) {
    const lines = readFileSync(`${root}/${path}`, 'utf8').split('\n');
    const { chunks } = await processFile(root, path);
    const covered = new Set<number>();
    for (const c of chunks) for (let l = c.startLine; l <= c.endLine; l++) covered.add(l);
    const missed = lines.flatMap((text, i) =>
      /\w/.test(text) && !covered.has(i + 1) ? [i + 1] : [],
    );
    expect(missed, path).toEqual([]);
  }
});

test('content hashes change only when content changes', async () => {
  const source = 'export function a() {\n  return 1;\n}\n\nexport function b() {\n  return 2;\n}\n';
  const edited = source.replace('return 2', 'return 3');
  const before = chunkFile('x.ts', 'typescript', source, await parseSource('typescript', source));
  const after = chunkFile('x.ts', 'typescript', edited, await parseSource('typescript', edited));
  expect(after[0]?.contentHash).toBe(before[0]?.contentHash);
  expect(after[1]?.contentHash).not.toBe(before[1]?.contentHash);
});
