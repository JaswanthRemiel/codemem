# Progress

## Phases

- [x] Phase 0: Scaffold
- [x] Phase 1: Scanner, parser, chunker
- [ ] Phase 2: Store and keyword search
- [ ] Phase 3: Embeddings, hybrid retrieval, packer
- [ ] Phase 4: Call graph
- [ ] Phase 5: MCP server and init
- [ ] Phase 6: Memory
- [ ] Phase 7: Incremental indexing, watch, stats
- [ ] Phase 8: Benchmark
- [ ] Phase 9: Release prep

## Done

### Phase 0

- Strict TypeScript, ESLint, Prettier, vitest.
- `codemem --version` and a `codemem doctor` stub (Node.js version check only).
- Em dash and emoji check in `npm run check:chars`, the pre-commit hook, and CI.
- CI matrix: Ubuntu, macOS, Windows with Node 22 and 24.
- MIT license, `DECISIONS.md`, `PROGRESS.md`, `SETUP.md`.

### Phase 1

- Scanner: `git ls-files` with a directory-walk fallback; skips vendored and generated code, lockfiles, minified files, binaries, files over 512 KB, and secrets.
- Parser: web-tree-sitter with WASM grammars and `.scm` queries for TypeScript, TSX, JavaScript, Python, and Go. Extracts symbols, call sites, and imports.
- Chunker: one chunk per function, method, interface, type, and enum; a header chunk per class; oversized symbols split at statement boundaries; line windows for everything else.
- Three fixture repos with golden files, plus hand-written assertions for the tricky cases.
- Hidden `codemem debug chunks <path>`; `codemem doctor` now checks the grammars.
- Speed: 277k to 1.1M-line repos scan and chunk in 1.7 to 3.7 seconds on one thread.

## Next

Phase 2: store, migrations, FTS5 keyword search, `codemem index`, `codemem search`.

## Known issues

- The config file (`.codemem/config.json`) is not read yet, so user `include` and `exclude` globs do not apply. It arrives with `codemem index` in Phase 2.
- Without git, `.gitignore` is not honored; only the built-in excludes apply.
- Import aliases (`import x as y`, Go named imports) are not recorded yet. Phase 4 needs them to resolve calls.
- Class header chunks are never split, even for very large classes.
- Line coverage is not measured: it needs `@vitest/coverage-v8`, which is not in the approved dependency list.
- `npm audit` reports moderate advisories for `minimatch`, pulled in by ESLint 10 and typescript-eslint 8. These are development tools only and are not part of the published package. No fixed release was available on 2026-11-12.
