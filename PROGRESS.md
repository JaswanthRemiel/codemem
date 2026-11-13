# Progress

## Phases

- [x] Phase 0: Scaffold
- [x] Phase 1: Scanner, parser, chunker
- [x] Phase 2: Store and keyword search
- [x] Phase 3: Embeddings, hybrid retrieval, packer
- [x] Phase 4: Call graph
- [x] Phase 5: MCP server and init
- [x] Phase 6: Memory
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

- Embedding input order: path, signature, docstring, then body, so the model's 256-token cut only removes the end of the body.
- Cold run, measured 2026-11-14 on an Apple M5 with a connection of about 12 MB/s, Node 24.20.0 and npm 11.19.0, with empty npm and model caches: `npx` of the packed tarball to first output 19.3s, first `index` of the `ts-app` fixture including the 23 MB model download 5.8s, first `search` 0.9s, 26.1s in total. The install downloads and unpacks about 750 MB into the npm cache.

### Phase 4

- Parser records every reference (calls, base classes, implemented interfaces, referenced types) and every import binding with its alias.
- Graph: references are resolved to symbols in the order same file, imports, unique name, each with a confidence of `exact`, `import`, or `name-match`. Module paths are resolved for TypeScript and JavaScript (relative paths, index files), Python (relative and absolute modules), and Go (through `go.mod`).
- All 37 hand-listed call edges of the three fixtures resolve to the right symbol with the expected confidence, and no other call edge is produced.
- Retrieval adds the direct neighbors of the top results as signature-only blocks with a reason (`calls X`, `called by Y`, `extends X`, `type used by X`, `contains X`).
- `describeSymbol` and `findReferences` (the future `get_symbol` and `find_references` tools), reachable now through hidden `codemem debug symbol` and `codemem debug refs`.
- Coverage threshold now includes `graph`.
- Measured on nest (commit 4410584, 277k lines, Apple M5): 107,851 call sites, of which 19,366 resolve (8,820 exact, 5,483 import, 5,063 name-match); the rest target libraries, test helpers, or values of unknown type. Rebuilding the whole graph takes 0.6s. Warm query p50 19 ms, p95 27 ms.
- Hand-check of resolved call edges on nest, 2026-11-14: a seeded random sample of 30 (22 name-match, 4 import, 4 exact), each judged by reading the call site and the target.

  | Confidence | Sampled | Correct | Precision |
  | ---------- | ------- | ------- | --------- |
  | exact      | 4       | 4       | 100%      |
  | import     | 4       | 4       | 100%      |
  | name-match | 22      | 16      | 73%       |
  | all        | 30      | 24      | 80%       |

  The six wrong edges were all name-matches on methods of things outside the repo: `Object.entries`, `Object.assign` (twice), `Object.keys(...).sort()`, `headers.append` on a web `Headers` object, and a supertest `.field()` call. Each matched the one repo symbol that happens to share the method name.

- Follow-up fix: a call on a capitalized receiver that is neither defined in the file nor imported (`Object`, `Math`, `JSON`) is no longer name-matched. That removes three of the six errors in the sample (16 of 19 name-matches correct, 84%; 24 of 27 overall, 89%) and 314 name-match edges on nest. The other three errors (a chained call, a variable holding a built-in object, a library's fluent method) need type information and remain. The sample is small, so treat these figures as rough.

### Phase 5

- MCP server over stdio (`codemem serve [--root <dir>]`) with six tools: `get_context`, `search_code`, `get_symbol`, `get_file_outline`, `find_references`, `index_status`. Inputs are zod schemas; results are plain text with a token footer; a failing call returns an error result and the server keeps running.
- Resource `codemem://overview`: a directory map to depth 3 with the most-referenced symbols per directory, rebuilt at index time and capped at 1,500 tokens.
- `codemem init` (config, `.gitignore` entry, first index with a progress bar, privacy statement, client configurations) and `codemem context "<task>"`.
- All logging goes to stderr at the level set by `CODEMEM_LOG_LEVEL`; a test fails if `serve` writes anything but protocol messages to stdout.
- Tool descriptions are under 80 tokens each.

### Phase 6

- Memory module: `remember`, `recall`, `forget` for decisions, conventions, gotchas, and todos, linked to files and symbols.
- Mirror at `.codemem/memory.json`, written on every change and treated as the source of truth: a changed file is loaded on the next command, and a deleted index is rebuilt from it.
- Staleness: each link stores a hash of the linked code; after every index run a memory whose linked file or symbol changed or disappeared is marked stale, and unmarked if the code returns to what it was.
- Recall fuses keyword and vector ranks like code search. Memories that arrive through the file are embedded on first recall.
- `get_context` starts with a project memory section: memories linked to the files of its results, then memories matching the task, within a quarter of the budget, stale ones marked.
- The three memory tools are registered, so the server offers nine tools. `codemem memory list/add/rm` do the same from the command line.
- Acceptance added by the owner on 2026-11-14: the MCP Inspector lists all nine tools. An automated test asserts the same list through the protocol; the Inspector itself is run by the owner.
- Coverage threshold now includes `memory`.

## Next

Phase 7: incremental indexing with a git fast path, `codemem watch`, auto-refresh before tool calls, the query log, and `codemem stats`.

## Notes for later phases

- Phase 7: prune unused embedding cache entries on `codemem index --full`.
- Phase 8: record the machine the benchmark ran on (CPU, memory, OS, Node.js version) in the results file and the README.
- Phase 8: the quantized embedding model gives slightly different vectors on different CPUs, so ranks can shift by a place. Either compare results with a tolerance or offer a full-precision model option, and say which in the README.
- Phase 8: add an ablation for graph expansion with and without `name-match` edges. If recall does not drop without them, leave `name-match` out of expansion by default.
- Phase 8: before deciding on `tsconfig.json` path alias support, check whether the chosen TypeScript benchmark repo uses `paths`.

## Known issues

- The default embedding model is a small general-purpose model, not a code-trained one (see decision 016). The benchmark in Phase 8 should compare it with `jinaai/jina-embeddings-v2-base-code`.
- The OpenAI and Voyage providers are tested against a stubbed HTTP server only, not the live services (no API key was used).
- Install size: `@huggingface/transformers` brings about 430 MB of ONNX runtime files into `node_modules`.
- Cached vectors of chunks that were edited away are never pruned. To do by Phase 7: prune unused cache entries on `codemem index --full`.
- Each vector is stored twice (search table and cache), which adds about 1.5 KB per chunk.
- `sqlite-vec` has no prebuilt extension for Windows on ARM.
- Memory staleness reflects the last index run; with no auto-refresh until Phase 7, run `codemem index` after editing.
- Keyword recall for `get_context` matches on any task word, so a loosely related memory can be included (at most five, within a quarter of the budget).
- Two people adding memories at once can produce a git merge conflict in `memory.json`; it is plain JSON with one memory per array entry, and a broken file is refused rather than loaded.
- The server answers from the index as it is: it does not re-index before a tool call until Phase 7.
- The MCP Inspector check and the manual run in Claude Code are documented in SETUP.md but were not run by the build agent; the same protocol paths are covered by automated tests.
- `codemem index` creates `.codemem/` but only `codemem init` adds the index to `.gitignore`.
- Only the tables in use exist so far. Edges, memories, and the query log arrive as migrations in the phases that use them.
- Without git, `.gitignore` is not honored; only the built-in excludes apply.
- Call resolution has no type inference: `user.save()` resolves only when one symbol in the repo is named `save`. On real code about one in four name-match edges is wrong (see the hand-check above); they carry the lowest retrieval weight (0.2).
- The graph is rebuilt in full after every index run that changed a file (0.7s on nest).
- Go struct embedding and implicit interface satisfaction produce no edges. TypeScript path aliases from `tsconfig.json` are not read; a non-relative import resolves only when exactly one file matches it.
- Class header chunks are never split, even for very large classes.
- `npm audit` reports moderate advisories for `minimatch`, pulled in by ESLint 10 and typescript-eslint 8. These are development tools only and are not part of the published package. No fixed release was available on 2026-11-12.
