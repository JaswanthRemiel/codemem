# Decisions

Each entry: context, options, decision, consequences.

## 001: Node.js 22 minimum, TypeScript pinned to 6.0

- **Context:** The spec said Node.js 20+, but Node 20 reached end of life in April 2026 and the current majors of vitest (5) and commander (15) need Node 22.12+. ESLint 10 needs 22.13+. typescript-eslint 8 does not accept TypeScript 7.
- **Options:** (a) keep Node 20 and pin older majors, (b) raise the minimum to Node 22 and use current majors.
- **Decision:** (b), by owner decision on 2026-11-12. The minimum is Node 22.13.0 and CI tests Node 22 and 24. TypeScript stays on 6.0 until typescript-eslint supports 7.
- **Consequences:** Node 20 users cannot install. Revisit the TypeScript pin when typescript-eslint adds TypeScript 7 support.

## 002: Git hooks without a hook manager

- **Context:** The em dash and emoji check must run before every commit.
- **Options:** (a) husky or a similar dependency, (b) a tracked `.githooks/` folder enabled with `git config core.hooksPath`.
- **Decision:** (b). The `prepare` script sets `core.hooksPath` on `npm install`.
- **Consequences:** No extra dependency. A contributor who never runs `npm install` has no hook, but CI runs the same check.

## 003: Em dash and emoji check definition

- **Context:** Hard rule 5 bans em dashes and emojis in every tracked file.
- **Decision:** `scripts/check-chars.mjs` scans `git ls-files` for U+2014 and any character with the Unicode `Extended_Pictographic` property. Files that contain a NUL byte are treated as binary and skipped.
- **Consequences:** `Extended_Pictographic` also covers a few symbols such as the copyright and trademark signs, so those are banned too. Plain digits, `#` and `*` are allowed.

## 004: ESLint without `@eslint/js` or `eslint-config-prettier`

- **Context:** Both are common additions that the tech stack table does not list.
- **Decision:** Use only `typescript-eslint` (strict preset). It has no formatting rules, so nothing conflicts with Prettier.
- **Consequences:** Plain JavaScript files (config and scripts) get the TypeScript-aware rules only, not the core recommended set.

## 005: Two tsconfig files

- **Context:** Tests live in `test/` and must be typechecked but not emitted to `dist/`.
- **Decision:** `tsconfig.json` typechecks `src` and `test` with `noEmit`; `tsconfig.build.json` extends it and emits `src` to `dist`.
- **Consequences:** `npm run typecheck` and `npm run build` use different configs on purpose.

## 006: Lint and format scripts list the project paths

- **Context:** A working copy can hold local files that are not part of the project, and committed files must not name them.
- **Decision:** `npm run lint`, `npm run format`, and `npm run format:check` list the project paths explicitly (`src`, `test`, `scripts`, `.github`, root `*.js` and `*.json`, and each root Markdown doc by name) instead of scanning the whole directory. There is no `.prettierignore`.
- **Consequences:** A new top-level folder or root Markdown doc must be added to these scripts in `package.json`.

## 007: Grammar WASM files are committed to the repo

- **Context:** `web-tree-sitter` needs one `.wasm` file per language.
- **Options:** (a) depend on the grammar npm packages, which bring native install scripts, (b) depend on a third-party bundle of prebuilt grammars, (c) commit the official release `.wasm` assets under `grammars/`.
- **Decision:** (c). Sources and versions are listed in `grammars/README.md`.
- **Consequences:** No extra dependency and no install step, at the cost of about 4 MB of binaries in git. Updating a grammar is a manual download.

## 008: No worker pool for parsing

- **Context:** The spec asks for a worker pool sized to the CPU count. The Phase 1 target is 100k lines in under 60 seconds.
- **Decision:** Parse on one thread. Measured: 277k lines in 1.7s and 1.1M lines in 3.7s, well over ten times faster than the target.
- **Consequences:** Less code and no worker startup cost. Revisit if parsing ever shows up as the slow stage; embedding is expected to dominate indexing time.

## 009: Chunking rules beyond the spec

- **Context:** The spec defines chunks for functions, methods, and classes, and line windows for unsupported languages. Real files also have nested functions, constants, imports, and top-level code.
- **Decision:**
  - Functions nested inside a function are symbols but get no chunk of their own; they stay in the outer function's chunk.
  - Interfaces, types, and enums get one chunk each. Constants do not.
  - Any lines no symbol chunk covers (imports, constants, top-level statements) become line windows, so nothing in a file is unsearchable.
  - Overload signatures are folded into the implementation that follows them. A signature with no implementation in the same scope (an abstract method) is not a symbol; it still appears in the class header chunk.
  - A symbol longer than 80 lines is split at statement boundaries. If one statement is itself longer than 80 lines it is cut by line count, so no symbol chunk exceeds the limit.
  - Go structs use the kind `class` so their methods attach to them.
- **Consequences:** Chunk sizes are bounded, which the packer relies on later. Class header chunks are the exception and are never split.

## 010: Queries live next to the grammars

- **Context:** The spec asks for `.scm` query files per language. They must ship in the npm package, which contains only `dist/`, `grammars/`, README, and LICENSE.
- **Decision:** Keep the `.scm` files in `grammars/` beside the `.wasm` files, so no build step copies them.
- **Consequences:** `src/parser/` has no query text; adding a language means adding two files to `grammars/` and one entry in the parser's language tables.

## 011: Identifier splitting happens before text reaches FTS5

- **Context:** The spec wants camelCase and snake_case split into parts while keeping the whole identifier. FTS5 custom tokenizers are written in C and cannot be registered through `better-sqlite3`.
- **Decision:** Expand text in TypeScript before indexing and before querying: each identifier is stored in lower case followed by its parts. The FTS5 table is contentless (`content=''`, `contentless_delete=1`) with the `unicode61` tokenizer, so the expanded text is searched but not stored twice. Query terms of three or more characters also match as a prefix, so `auth` finds `authenticate`.
- **Consequences:** No native code. There is no stemming, so `hashed` does not match `hash`; vector search is expected to cover that. Requires SQLite 3.43 or newer, which `better-sqlite3` bundles.

## 012: Which query words count as exact symbol names

- **Context:** The spec ranks a symbol first when a query token equals its name. On a real repo, an ordinary word such as `resolve` in a sentence pulled in every symbol with that name ahead of better matches.
- **Decision:** A token is looked up as a symbol name only if it is shaped like an identifier (camelCase, snake_case, a dotted path, or containing a digit) or if it is the whole query.
- **Consequences:** `codemem search normalize` still returns the function first; "how to resolve a route" relies on keyword ranking instead.

## 013: Schema built up by migrations, one phase at a time

- **Context:** The data model lists ten tables; Phase 2 uses five.
- **Decision:** Migration 1 creates `meta`, `files`, `symbols`, `chunks`, and `chunks_fts`. Later phases append migrations for vectors, edges, memories, and the query log. `symbols` has an extra `docstring` column, which signature compression needs in Phase 3. A separate `index_format` value in `meta` forces a full reindex when the parser or chunker changes what is stored.
- **Consequences:** No empty, untested tables. Existing indexes upgrade in place.

## 014: Token counts use the o200k_base encoding

- **Context:** Budgets need a token count per chunk. Different models tokenize differently.
- **Decision:** Count with `js-tiktoken` and the `o200k_base` encoding, and describe every count as approximate.
- **Consequences:** Counting 1 MB of code takes about 0.14s, so it does not need caching.
