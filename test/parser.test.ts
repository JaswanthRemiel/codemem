import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { GrammarError } from '../src/errors.js';
import { languageOf, parseSource, type Lang, type ParsedFile } from '../src/parser/index.js';

async function parse(path: string): Promise<ParsedFile> {
  const source = readFileSync(`test/fixtures/${path}`, 'utf8');
  const parsed = await parseSource(languageOf(path) as Lang, source);
  if (!parsed) throw new Error(`no parse for ${path}`);
  return parsed;
}

const kinds = (p: ParsedFile): Record<string, string> =>
  Object.fromEntries(p.symbols.map((s) => [s.qualifiedName, s.kind]));

/** Calls as "caller -> callee", the known call graph of a fixture file. */
const edges = (p: ParsedFile): string[] =>
  p.refs
    .filter((r) => r.kind === 'call')
    .map((r) => `${r.from === null ? '<file>' : p.symbols[r.from]?.qualifiedName} -> ${r.name}`);

/** References of another kind as "from kind name". */
const others = (p: ParsedFile, kind: string): string[] =>
  p.refs
    .filter((r) => r.kind === kind)
    .map(
      (r) => `${r.from === null ? '<file>' : p.symbols[r.from]?.qualifiedName} ${kind} ${r.name}`,
    );

const symbol = (p: ParsedFile, name: string) => {
  const found = p.symbols.find((s) => s.qualifiedName === name);
  if (!found) throw new Error(`no symbol ${name}`);
  return found;
};

test('languageOf maps extensions and leaves the rest to line windows', () => {
  expect(languageOf('a/b.TS')).toBe('typescript');
  expect(languageOf('x.tsx')).toBe('tsx');
  expect(languageOf('x.mjs')).toBe('javascript');
  expect(languageOf('x.py')).toBe('python');
  expect(languageOf('x.go')).toBe('go');
  expect(languageOf('schema.sql')).toBeNull();
});

test('TypeScript: arrow consts, overloads, nested functions, exports', async () => {
  const auth = await parse('ts-app/src/auth.ts');
  expect(kinds(auth)).toEqual({
    Claims: 'interface',
    authenticateUser: 'function',
    'authenticateUser.verify': 'function',
    parseToken: 'function',
    resetPassword: 'function',
  });
  // Three overload lines collapse into one symbol that spans all of them.
  const parseToken = symbol(auth, 'parseToken');
  expect(parseToken.signature.split('\n')).toHaveLength(3);
  expect([parseToken.startLine, parseToken.endLine]).toEqual([25, 34]);
  expect(symbol(auth, 'authenticateUser').docstring).toBe(
    'Checks a password against the stored hash.\nReturns false for unknown users.',
  );
  expect(edges(auth)).toEqual(
    expect.arrayContaining([
      'authenticateUser -> findUser',
      'authenticateUser -> verify',
      'authenticateUser -> hash',
      'authenticateUser.verify -> timingSafeEqual',
      'resetPassword -> saveUser',
    ]),
  );
  expect(auth.imports).toEqual([
    { source: './hash', name: 'default', local: 'hash', line: 1 },
    { source: './db', name: 'findUser', local: 'findUser', line: 2 },
    { source: './db', name: 'saveUser', local: 'saveUser', line: 2 },
    { source: './db', name: 'User', local: 'User', line: 2 },
    { source: 'node:crypto', name: '*', local: 'crypto', line: 3 },
  ]);
  expect(others(auth, 'type')).toContain('parseToken type Claims');

  const db = await parse('ts-app/src/db.ts');
  expect(kinds(db)).toEqual({
    UserId: 'type',
    Role: 'enum',
    User: 'interface',
    USERS: 'constant',
    findUser: 'function',
    saveUser: 'function',
  });
  expect(kinds(await parse('ts-app/src/hash.ts'))).toEqual({ SALT: 'constant', hash: 'function' });
});

test('TypeScript: classes, decorators, method overloads, arrow fields', async () => {
  const service = await parse('ts-app/src/service.ts');
  expect(kinds(service)).toMatchObject({
    BaseService: 'class',
    'BaseService.now': 'method',
    UserService: 'class',
    'UserService.create': 'method',
    'UserService.constructor': 'method',
    'UserService.login': 'method',
    'UserService.find': 'method',
    'UserService.audit': 'method',
  });
  // The abstract signature has no implementation in its class, so it is not a symbol.
  expect(kinds(service)).not.toHaveProperty('BaseService.dispose');
  expect(symbol(service, 'UserService').signature).toBe(
    '@Injectable() export class UserService extends BaseService',
  );
  const login = symbol(service, 'UserService.login');
  expect(login.signature).toMatch(/^@Log\('login'\) async login\(/);
  expect(login.startLine).toBe(33); // the decorator line
  expect(symbol(service, 'UserService.find').signature.split('\n')).toHaveLength(3);
  expect(edges(service)).toEqual(
    expect.arrayContaining([
      'UserService.login -> authenticateUser',
      'UserService.login -> audit',
      'UserService.find -> findUser',
      'UserService.fromToken -> find',
      'UserService.fromToken -> parseToken',
      'UserService.create -> UserService',
    ]),
  );
  const audit = service.refs.find((r) => r.name === 'audit');
  expect(audit?.receiver).toBe('this');
  expect(others(service, 'extends')).toEqual(['UserService extends BaseService']);
  // A class name is not a reference to itself.
  expect(others(service, 'type')).not.toContain('UserService type UserService');
});

test('JavaScript and TSX: CommonJS, class fields, components', async () => {
  const legacy = await parse('ts-app/src/legacy.js');
  expect(kinds(legacy)).toEqual({
    LegacyLogin: 'class',
    'LegacyLogin.handle': 'method',
    oldLogin: 'function',
    health: 'function',
  });
  expect(legacy.imports).toEqual([
    { source: './service', name: 'UserService', local: 'UserService', line: 1 },
  ]);
  // `new LegacyLogin().handle(req)`: there is a receiver, but it is not a plain name.
  expect(legacy.refs.find((r) => r.name === 'handle')?.receiver).toBe('');
  expect(
    legacy.refs.find((r) => r.name === 'oldLogin' || r.name === 'LegacyLogin')?.receiver,
  ).toBeNull();

  const view = await parse('ts-app/src/view.tsx');
  expect(kinds(view)).toEqual({
    Props: 'interface',
    formatName: 'function',
    UserBadge: 'function',
  });
  expect(edges(view)).toEqual(['UserBadge -> formatName']);
});

test('Python: decorators, class and static methods, nested and async functions', async () => {
  const orders = await parse('py-pkg/shop/orders.py');
  expect(kinds(orders)).toEqual({
    retry: 'function',
    'retry.decorator': 'function',
    'retry.decorator.wrapper': 'function',
    Order: 'class',
    'Order.from_dict': 'method',
    'Order.validate_sku': 'method',
    'Order.total': 'method',
    'Order.add': 'method',
    pay: 'function',
    submit_order: 'function',
    validate_order: 'function',
  });
  expect(symbol(orders, 'Order.from_dict').signature).toBe(
    '@classmethod def from_dict(cls, data):',
  );
  expect(symbol(orders, 'Order.validate_sku').signature).toMatch(/^@staticmethod def /);
  expect(symbol(orders, 'submit_order').signature).toBe('async def submit_order(data):');
  expect(symbol(orders, 'Order.add').signature).toBe('def add(self, sku, price, qty=1):');
  expect(symbol(orders, 'Order').docstring).toBe('A customer order.');
  expect(symbol(orders, 'pay').startLine).toBe(52); // the decorator line
  expect(edges(orders)).toEqual(
    expect.arrayContaining([
      'pay -> retry',
      'pay -> charge',
      'submit_order -> validate_order',
      'submit_order -> from_dict',
      'submit_order -> pay',
      'submit_order -> notify',
      'Order.add -> validate_sku',
      'retry.decorator.wrapper -> fn',
    ]),
  );
  expect(orders.imports.filter((i) => i.source === '.payments').map((i) => i.name)).toEqual([
    'MAX_RETRIES',
    'PaymentError',
    'charge',
    'notify',
  ]);

  const payments = await parse('py-pkg/shop/payments.py');
  expect(kinds(payments)).toEqual({
    MAX_RETRIES: 'constant',
    PaymentError: 'class',
    charge: 'function',
    notify: 'function',
  });
  expect(payments.imports).toEqual([
    { source: 'asyncio', name: '*', local: 'asyncio', line: 1 },
    { source: 'logging', name: '*', local: 'log', line: 2 },
  ]);
  expect(others(payments, 'extends')).toEqual(['PaymentError extends Exception']);
});

test('Go: pointer and value receivers, interfaces, grouped declarations', async () => {
  const store = await parse('go-mod/store.go');
  expect(kinds(store)).toEqual({
    DefaultCapacity: 'constant',
    MaxKeyLength: 'constant',
    separator: 'constant',
    ErrNotFound: 'constant',
    Key: 'type',
    Entry: 'class',
    Reader: 'interface',
    Store: 'class',
    New: 'function',
    'Store.Get': 'method',
    'Store.Set': 'method',
    'Store.Len': 'method',
    Join: 'function',
    normalize: 'function',
  });
  expect(symbol(store, 'Store.Get').signature).toBe('func (s *Store) Get(key Key) (string, error)');
  expect(symbol(store, 'Store.Len').signature).toBe('func (s Store) Len() int');
  const storeIndex = store.symbols.findIndex((s) => s.qualifiedName === 'Store');
  expect(symbol(store, 'Store.Get').parent).toBe(storeIndex);
  expect(symbol(store, 'Store.Len').parent).toBe(storeIndex);
  expect(symbol(store, 'Store.Get').docstring).toBe(
    'Get returns the value for key and counts the hit.',
  );
  expect(edges(store)).toEqual(
    expect.arrayContaining([
      'Store.Get -> normalize',
      'Store.Set -> normalize',
      'Join -> normalize',
      'normalize -> ToLower',
    ]),
  );
  // The local name is the alias when there is one, otherwise the last path segment.
  expect(store.imports.map((i) => `${i.source} as ${i.local}`)).toEqual([
    'errors as errors',
    'fmt as fmt',
    'strings as str',
  ]);
  expect(others(store, 'type')).toContain('Store.Get type Store');

  const main = await parse('go-mod/cmd/kv/main.go');
  expect(main.imports.at(-1)).toMatchObject({ source: 'example.com/kv', name: '*', local: 'kv' });
  expect(edges(main)).toEqual(
    expect.arrayContaining([
      'main -> New',
      'main -> run',
      'run -> Join',
      'run -> Set',
      'run -> Get',
    ]),
  );
});

test('a file with syntax errors still yields the symbols around the error', async () => {
  const parsed = await parseSource('typescript', 'function ok() {}\nfunction broken( {\n');
  expect(parsed?.symbols.map((s) => s.name)).toContain('ok');
});

test('an unknown grammar fails with an actionable error', async () => {
  await expect(parseSource('ruby' as Lang, '')).rejects.toThrow(GrammarError);
  await expect(parseSource('ruby' as Lang, '')).rejects.toThrow(/remimem doctor/);
});
