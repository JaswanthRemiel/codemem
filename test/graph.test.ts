import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { describeSymbol, findReferences } from '../src/graph/describe.js';
import { resolveReferences } from '../src/graph/index.js';
import { indexRepo } from '../src/indexer/index.js';
import { search } from '../src/retriever/index.js';
import type { GraphInput, Store } from '../src/store/index.js';
import { runIndex, runRefs, runSymbol } from '../src/cli/commands.js';
import { copyFixture, indexed, TEST_CONFIG } from './helpers.js';

/** Every edge of a kind as "from -> to [confidence]", read back through the store. */
function edges(store: Store, relation: string): string[] {
  const symbols = store.graphInput().symbols;
  const names = new Map(symbols.map((s) => [s.id, s.qualifiedName]));
  return store
    .neighbors(symbols.map((s) => s.id))
    .filter((n) => n.relation === relation)
    .map((n) => `${names.get(n.of)} -> ${n.qualifiedName} [${n.confidence}]`)
    .sort();
}

// The call graph of each fixture, written by hand from the source: every call whose target
// is defined in the fixture, with the confidence the resolution order should give it.
const CALLS: Record<string, string[]> = {
  'ts-app': [
    'LegacyLogin -> UserService.create [import]',
    'LegacyLogin.handle -> UserService.login [name-match]',
    'UserBadge -> formatName [exact]',
    'UserService -> Injectable [exact]',
    'UserService.create -> UserService [exact]',
    'UserService.find -> findUser [import]',
    'UserService.fromToken -> UserService.find [exact]',
    'UserService.fromToken -> parseToken [import]',
    'UserService.login -> Log [exact]',
    'UserService.login -> UserService.audit [exact]',
    'UserService.login -> authenticateUser [import]',
    'authenticateUser -> authenticateUser.verify [exact]',
    'authenticateUser -> findUser [import]',
    'authenticateUser -> hash [import]',
    'oldLogin -> LegacyLogin [exact]',
    'oldLogin -> LegacyLogin.handle [exact]',
    'resetPassword -> hash [import]',
    'resetPassword -> saveUser [import]',
  ],
  'py-pkg': [
    'Order.add -> Order.validate_sku [exact]',
    'charge -> PaymentError [exact]',
    'pay -> charge [import]',
    'pay -> retry [exact]',
    'submit_order -> Order.from_dict [exact]',
    'submit_order -> notify [import]',
    'submit_order -> pay [exact]',
    'submit_order -> validate_order [exact]',
    'validate_order -> Order.validate_sku [exact]',
  ],
  'go-mod': [
    'Join -> Key [exact]',
    'Join -> normalize [exact]',
    'Store.Get -> normalize [exact]',
    'Store.Set -> normalize [exact]',
    'main -> New [import]',
    'main -> run [exact]',
    'normalize -> Key [exact]',
    'run -> Join [import]',
    'run -> Store.Get [name-match]',
    'run -> Store.Set [name-match]',
  ],
};

test.each(Object.keys(CALLS))(
  '%s: at least 90%% of the known call edges resolve',
  async (fixture) => {
    const { store } = await indexed(fixture);
    const expected = CALLS[fixture] as string[];
    const found = edges(store, 'calls');
    const correct = expected.filter((edge) => found.includes(edge));
    expect(correct.length / expected.length).toBeGreaterThanOrEqual(0.9);
    // Nothing is invented: calls into libraries (fmt, crypto, logging) produce no edge.
    expect(found.filter((edge) => !expected.includes(edge))).toEqual([]);
    store.close();
  },
);

test('inheritance and type references become edges', async () => {
  const ts = await indexed('ts-app');
  expect(edges(ts.store, 'extends')).toEqual(['UserService -> BaseService [exact]']);
  expect(edges(ts.store, 'uses-type')).toEqual(
    expect.arrayContaining([
      'parseToken -> Claims [exact]',
      'UserService.find -> User [import]',
      'formatName -> User [import]',
      'User -> Role [exact]',
    ]),
  );
  ts.store.close();
  const go = await indexed('go-mod');
  expect(edges(go.store, 'uses-type')).toEqual(
    expect.arrayContaining(['Store.Get -> Store [exact]', 'Reader -> Key [exact]']),
  );
  go.store.close();
});

test('resolution order and its limits, on a hand-built graph', () => {
  const symbol = (
    id: number,
    fileId: number,
    name: string,
    kind = 'function',
    parentId: number | null = null,
  ) => ({
    id,
    fileId,
    name,
    qualifiedName: name,
    kind,
    parentId,
  });
  const input: GraphInput = {
    files: [
      { id: 1, path: 'src/a.ts', language: 'typescript' },
      { id: 2, path: 'src/lib/index.ts', language: 'typescript' },
      { id: 3, path: 'src/c.ts', language: 'typescript' },
      { id: 4, path: 'tools/d.py', language: 'python' },
    ],
    symbols: [
      symbol(10, 1, 'main'),
      symbol(11, 1, 'helper'),
      symbol(20, 2, 'helper'),
      symbol(21, 2, 'render'),
      symbol(30, 3, 'render'),
      symbol(31, 3, 'onlyHere'),
      symbol(40, 4, 'onlyHere'),
      symbol(41, 4, 'py_main'),
    ],
    refs: [
      // Same file beats an import of the same name.
      { id: 1, fileId: 1, symbolId: 10, kind: 'call', name: 'helper', receiver: null },
      // Through a namespace import of a directory with an index file.
      { id: 2, fileId: 1, symbolId: 10, kind: 'call', name: 'render', receiver: 'lib' },
      // Two candidates in the repo and no import: not resolved.
      { id: 3, fileId: 3, symbolId: 31, kind: 'call', name: 'helper', receiver: null },
      // A package that is not in the repo: never falls back to a name match.
      { id: 4, fileId: 1, symbolId: 10, kind: 'call', name: 'onlyHere', receiver: 'react' },
      // Unique within its language family, even though Python has the same name.
      { id: 5, fileId: 1, symbolId: 10, kind: 'call', name: 'onlyHere', receiver: '' },
      // A call at file level has no source symbol but still resolves.
      { id: 6, fileId: 4, symbolId: null, kind: 'call', name: 'py_main', receiver: null },
      // A type reference never resolves to a function.
      { id: 7, fileId: 1, symbolId: 10, kind: 'type', name: 'helper', receiver: null },
    ],
    imports: [
      { id: 1, fileId: 1, source: './lib', name: 'helper', local: 'helper' },
      { id: 2, fileId: 1, source: './lib', name: '*', local: 'lib' },
      { id: 3, fileId: 1, source: 'react', name: '*', local: 'react' },
      { id: 4, fileId: 3, source: './missing', name: 'helper', local: 'gone' },
    ],
    goModules: [],
  };
  const { refs, imports } = resolveReferences(input);
  expect(refs).toEqual([
    { id: 1, target: 11, confidence: 'exact' },
    { id: 2, target: 21, confidence: 'import' },
    { id: 5, target: 31, confidence: 'name-match' },
    { id: 6, target: 41, confidence: 'exact' },
  ]);
  expect(imports).toEqual([{ id: 1, target: 20 }]);
});

test('get_symbol shows callers and callees, and follows them to the requested depth', async () => {
  const { store } = await indexed('ts-app');
  const one = describeSymbol(store, 'authenticateUser', { depth: 1 });
  expect(one.split('\n')[0]).toBe('--- src/auth.ts:10-23 function authenticateUser');
  expect(one).toContain('return verify(user.passwordHash, hash(password));');
  expect(one).toContain(
    [
      'Calls:',
      '  authenticateUser.verify  src/auth.ts:16-18  [exact]',
      '  findUser  src/db.ts:19-21  [import]',
      '  hash  src/hash.ts:4-10  [import]',
    ].join('\n'),
  );
  expect(one).toContain('Called by:\n  UserService.login  src/service.ts:33-38  [import]');
  expect(one).not.toContain('LegacyLogin.handle');

  const two = describeSymbol(store, 'authenticateUser', { depth: 2 });
  expect(two).toContain(
    'Called by:\n  UserService.login  src/service.ts:33-38  [import]\n    LegacyLogin.handle  src/legacy.js:6-8  [name-match]',
  );
  expect(describeSymbol(store, 'authenticateUser', { depth: 0 })).not.toContain('Calls:');

  const signature = describeSymbol(store, 'UserService.login', { include: 'signature' });
  expect(signature.split('\n').slice(0, 2)).toEqual([
    '--- src/service.ts:33-38 method UserService.login',
    "@Log('login') async login(id: string, password: string): Promise<boolean>",
  ]);
  expect(signature).toContain('Inside:\n  UserService  src/service.ts:23-59  [exact]');
  expect(describeSymbol(store, 'UserService')).toContain('Extends:\n  BaseService');
  expect(describeSymbol(store, 'nope')).toBe('No symbol named "nope" in the index.');
  store.close();

  // An ambiguous name lists the candidates instead of guessing.
  const py = await indexed('py-pkg');
  writeFileSync(join(py.root, 'shop/extra.py'), 'def charge():\n    return 0\n');
  await indexRepo(py.root, py.store, TEST_CONFIG);
  const ambiguous = describeSymbol(py.store, 'charge');
  expect(ambiguous).toMatch(/^2 symbols are named "charge"/);
  expect(ambiguous).toContain('function charge  shop/payments.py:11-16');
  expect(ambiguous).toContain('function charge  shop/extra.py:1-2');
  // The whole of a split function comes back as one block.
  const whole = describeSymbol(py.store, 'validate_order', { depth: 0 });
  expect(whole.split('\n')[0]).toBe('--- shop/orders.py:68-164 function validate_order');
  py.store.close();
});

test('find_references lists callers and importers by file', async () => {
  const { store } = await indexed('ts-app');
  expect(findReferences(store, 'findUser')).toBe(
    [
      '4 references in 2 files to function findUser at src/db.ts:19-21',
      '',
      'src/auth.ts',
      '  src/auth.ts:2  import',
      '  src/auth.ts:20  call in authenticateUser [import]',
      '',
      'src/service.ts',
      '  src/service.ts:2  import',
      '  src/service.ts:43  call in UserService.find [import]',
    ].join('\n'),
  );
  const user = findReferences(store, 'User');
  expect(user).toContain('src/view.tsx:1  import');
  expect(user).toContain('type in UserService.find [import]');
  expect(findReferences(store, 'BaseService')).toContain('extends in UserService [exact]');
  expect(findReferences(store, 'UserService.dispose')).toMatch(/^No references found to method/);
  expect(findReferences(store, 'nope')).toBe('No symbol named "nope" in the index.');
  store.close();
});

test('search adds graph neighbors as signature-only results with a reason', async () => {
  const { store } = await indexed('ts-app');
  const results = await search(store, 'authenticateUser', TEST_CONFIG.retrieval, null, 1);
  const top = results[0];
  expect(top?.detail).toBe('full');
  const neighbors = results.slice(1);
  expect(neighbors.map((r) => `${r.chunk.symbol}: ${r.reasons.join(', ')}`)).toEqual([
    'findUser: called by authenticateUser',
    'hash: called by authenticateUser',
    'UserService.login: calls authenticateUser',
  ]);
  for (const n of neighbors) expect(n.detail).toBe('signature');
  // Score is the result's score times the edge weight: import 0.4 here.
  expect(neighbors[0]?.score).toBeCloseTo((top?.score ?? 0) * 0.4);
  // The nested function is part of the result's own text, so it is not repeated.
  expect(neighbors.map((r) => r.chunk.symbol)).not.toContain('authenticateUser.verify');

  // A neighbor that is already a result only gains the reason.
  const both = await search(store, 'authenticateUser findUser', TEST_CONFIG.retrieval, null, 2);
  const findUser = both.find((r) => r.chunk.symbol === 'findUser');
  expect(findUser?.detail).toBe('full');
  expect(findUser?.reasons).toContain('called by authenticateUser');

  // The limits come from config: no seeds, no neighbors; a cap of one keeps the best.
  const off = { ...TEST_CONFIG.retrieval, graphTopN: 0 };
  expect(await search(store, 'authenticateUser', off, null, 1)).toHaveLength(1);
  const capped = { ...TEST_CONFIG.retrieval, graphMaxNeighbors: 1 };
  expect(await search(store, 'authenticateUser', capped, null, 1)).toHaveLength(2);
  store.close();
});

test('the graph follows the files: edits and deletions update the edges', async () => {
  const { root, store } = await indexed('ts-app');
  // One import and two calls, all in auth.ts.
  expect(findReferences(store, 'hash')).toMatch(/^3 references in 1 file/);
  rmSync(join(root, 'src/auth.ts'));
  await indexRepo(root, store, TEST_CONFIG);
  expect(findReferences(store, 'hash')).toMatch(/^No references found/);
  expect(edges(store, 'calls').some((edge) => edge.includes('authenticateUser'))).toBe(false);
  store.close();
});

test('the debug commands print a symbol and its references', async () => {
  const root = copyFixture('go-mod');
  expect(() => runRefs(root, 'New')).toThrow(/codemem index/);
  mkdirSync(join(root, '.codemem'));
  writeFileSync(join(root, '.codemem/config.json'), '{ "embedding": { "provider": "none" } }');
  await runIndex(root, {});
  expect(runSymbol(root, 'Store.Get', { depth: 1 })).toContain(
    'Called by:\n  run  cmd/kv/main.go:18-29  [name-match]',
  );
  expect(runRefs(root, 'New')).toContain('cmd/kv/main.go:11  call in main [import]');
});
