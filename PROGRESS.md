# Progress

## Phases

- [x] Phase 0: Scaffold
- [x] Phase 1: Scanner, parser, chunker
- [x] Phase 2: Store and keyword search
- [x] Phase 3: Embeddings, hybrid retrieval, packer
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

### Phase 2

- Store: one SQLite file with numbered migrations, WAL mode, and an FTS5 index. Only `src/store/` contains SQL.
- Identifier-aware keyword search: identifiers are indexed whole and by their camelCase and snake_case parts.
- `codemem index [--full]`: skips files whose content hash is unchanged and removes files that disappeared.
- `codemem search "<query>" [-k N] [--debug]`: BM25 keyword search with exact symbol names ranked first.
- Config file `.codemem/config.json` (`include`, `exclude`, `maxFileSizeKb`), validated with zod.
- Approximate token counts stored per chunk.
- Coverage is measured in CI: 80% line threshold on `parser`, `chunker`, and `retriever` (currently 99% to 100%).
- Speed: nest (277k lines) indexes in 3.6s; a second run with nothing changed takes 0.3s.

### Phase 3

- Embedder: provider interface with a local default model (`Xenova/all-MiniLM-L6-v2`, 384 dimensions), optional OpenAI and Voyage providers, batching, retries, and a cache keyed by text hash and model.
- Vectors in `sqlite-vec`; a model change is detected and requires `codemem index --full`.
- Hybrid retrieval: keyword and vector lists fused with reciprocal rank fusion, exact symbol names on top, a reason on every result.
- Packer: token-budgeted output grouped by file in line order, joined adjacent chunks, signature-only blocks, and a footer. A seeded property test checks the output never exceeds the budget.
- Config: `embedding` and `retrieval` blocks with every weight and limit.
- `codemem search --budget N --debug`; `codemem doctor` checks SQLite, sqlite-vec, and the embedding model.
- Measured on nest (277k lines, 17,008 chunks, Apple M5): full index with embeddings 106s, warm query p50 15 ms and p95 18 ms, index file 121 MB.

## Next

Phase 4: call graph edges with confidence, `find_references`, graph expansion in retrieval, import aliases.

## Known issues

- The default embedding model is a small general-purpose model, not a code-trained one (see decision 016). The benchmark in Phase 8 should compare it with `jinaai/jina-embeddings-v2-base-code`.
- The OpenAI and Voyage providers are tested against a stubbed HTTP server only, not the live services (no API key was used).
- Install size: `@huggingface/transformers` brings about 430 MB of ONNX runtime files into `node_modules`.
- Each vector is stored twice (search table and cache), which adds about 1.5 KB per chunk.
- `sqlite-vec` has no prebuilt extension for Windows on ARM.
- `codemem index` creates `.codemem/` but does not add it to `.gitignore`; `codemem init` does that in Phase 5.
- Only the tables in use exist so far. Edges, memories, and the query log arrive as migrations in the phases that use them.
- Without git, `.gitignore` is not honored; only the built-in excludes apply.
- Import aliases (`import x as y`, Go named imports) are not recorded yet. Phase 4 needs them to resolve calls.
- Class header chunks are never split, even for very large classes.
- `npm audit` reports moderate advisories for `minimatch`, pulled in by ESLint 10 and typescript-eslint 8. These are development tools only and are not part of the published package. No fixed release was available on 2026-11-12.
