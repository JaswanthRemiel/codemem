# Progress

## Phases

- [x] Phase 0: Scaffold
- [x] Phase 1: Scanner, parser, chunker
- [x] Phase 2: Store and keyword search
- [x] Phase 3: Embeddings, hybrid retrieval, packer
- [x] Phase 4: Call graph
- [x] Phase 5: MCP server and init
- [x] Phase 6: Memory
- [x] Phase 7: Incremental indexing, watch, stats
- [x] Phase 8: Benchmark
- [x] Phase 9: Release prep

## Done

### Phase 0

- Strict TypeScript, ESLint, Prettier, vitest.
- `remimem --version` and a `remimem doctor` stub (Node.js version check only).
- Em dash and emoji check in `npm run check:chars`, the pre-commit hook, and CI.
- CI matrix: Ubuntu, macOS, Windows with Node 22 and 24.
- MIT license, `DECISIONS.md`, `PROGRESS.md`, `SETUP.md`.

### Phase 1

- Scanner: `git ls-files` with a directory-walk fallback; skips vendored and generated code, lockfiles, minified files, binaries, files over 512 KB, and secrets.
- Parser: web-tree-sitter with WASM grammars and `.scm` queries for TypeScript, TSX, JavaScript, Python, and Go. Extracts symbols, call sites, and imports.
- Chunker: one chunk per function, method, interface, type, and enum; a header chunk per class; oversized symbols split at statement boundaries; line windows for everything else.
- Three fixture repos with golden files, plus hand-written assertions for the tricky cases.
- Hidden `remimem debug chunks <path>`; `remimem doctor` now checks the grammars.
- Speed: 277k to 1.1M-line repos scan and chunk in 1.7 to 3.7 seconds on one thread.

### Phase 2

- Store: one SQLite file with numbered migrations, WAL mode, and an FTS5 index. Only `src/store/` contains SQL.
- Identifier-aware keyword search: identifiers are indexed whole and by their camelCase and snake_case parts.
- `remimem index [--full]`: skips files whose content hash is unchanged and removes files that disappeared.
- `remimem search "<query>" [-k N] [--debug]`: BM25 keyword search with exact symbol names ranked first.
- Config file `.remimem/config.json` (`include`, `exclude`, `maxFileSizeKb`), validated with zod.
- Approximate token counts stored per chunk.
- Coverage is measured in CI: 80% line threshold on `parser`, `chunker`, and `retriever` (currently 99% to 100%).
- Speed: nest (277k lines) indexes in 3.6s; a second run with nothing changed takes 0.3s.

### Phase 3

- Embedder: provider interface with a local default model (`Xenova/all-MiniLM-L6-v2`, 384 dimensions), optional OpenAI and Voyage providers, batching, retries, and a cache keyed by text hash and model.
- Vectors in `sqlite-vec`; a model change is detected and requires `remimem index --full`.
- Hybrid retrieval: keyword and vector lists fused with reciprocal rank fusion, exact symbol names on top, a reason on every result.
- Packer: token-budgeted output grouped by file in line order, joined adjacent chunks, signature-only blocks, and a footer. A seeded property test checks the output never exceeds the budget.
- Config: `embedding` and `retrieval` blocks with every weight and limit.
- `remimem search --budget N --debug`; `remimem doctor` checks SQLite, sqlite-vec, and the embedding model.
- Measured on nest (277k lines, 17,008 chunks, Apple M5): full index with embeddings 106s, warm query p50 15 ms and p95 18 ms, index file 121 MB.

- Embedding input order: path, signature, docstring, then body, so the model's 256-token cut only removes the end of the body.
- Cold run, measured 2026-11-14 on an Apple M5 with a connection of about 12 MB/s, Node 24.20.0 and npm 11.19.0, with empty npm and model caches: `npx` of the packed tarball to first output 19.3s, first `index` of the `ts-app` fixture including the 23 MB model download 5.8s, first `search` 0.9s, 26.1s in total. The install downloads and unpacks about 750 MB into the npm cache.

### Phase 4

- Parser records every reference (calls, base classes, implemented interfaces, referenced types) and every import binding with its alias.
- Graph: references are resolved to symbols in the order same file, imports, unique name, each with a confidence of `exact`, `import`, or `name-match`. Module paths are resolved for TypeScript and JavaScript (relative paths, index files), Python (relative and absolute modules), and Go (through `go.mod`).
- All 37 hand-listed call edges of the three fixtures resolve to the right symbol with the expected confidence, and no other call edge is produced.
- Retrieval adds the direct neighbors of the top results as signature-only blocks with a reason (`calls X`, `called by Y`, `extends X`, `type used by X`, `contains X`).
- `describeSymbol` and `findReferences` (the future `get_symbol` and `find_references` tools), reachable now through hidden `remimem debug symbol` and `remimem debug refs`.
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

- MCP server over stdio (`remimem serve [--root <dir>]`) with six tools: `get_context`, `search_code`, `get_symbol`, `get_file_outline`, `find_references`, `index_status`. Inputs are zod schemas; results are plain text with a token footer; a failing call returns an error result and the server keeps running.
- Resource `remimem://overview`: a directory map to depth 3 with the most-referenced symbols per directory, rebuilt at index time and capped at 1,500 tokens.
- `remimem init` (config, `.gitignore` entry, first index with a progress bar, privacy statement, client configurations) and `remimem context "<task>"`.
- All logging goes to stderr at the level set by `REMIMEM_LOG_LEVEL`; a test fails if `serve` writes anything but protocol messages to stdout.
- Tool descriptions are under 80 tokens each.

### Phase 6

- Memory module: `remember`, `recall`, `forget` for decisions, conventions, gotchas, and todos, linked to files and symbols.
- Mirror at `.remimem/memory.json`, written on every change and treated as the source of truth: a changed file is loaded on the next command, and a deleted index is rebuilt from it.
- Staleness: each link stores a hash of the linked code; after every index run a memory whose linked file or symbol changed or disappeared is marked stale, and unmarked if the code returns to what it was.
- Recall fuses keyword and vector ranks like code search. Memories that arrive through the file are embedded on first recall.
- `get_context` starts with a project memory section, within a quarter of the budget, stale ones marked. A memory is attached automatically when it is linked to a result's file as a whole or to a symbol that is in the results; any other memory has to match the task.
- Matching needs a minimum on at least one side: half of the query's terms (`retrieval.memoryMinKeywordMatch`) or cosine similarity 0.3 (`retrieval.memoryMinSimilarity`). One shared word is not a match. The same rule applies to the `recall` tool.
- `memory.json` is written sorted by id with one memory per line.
- The three memory tools are registered, so the server offers nine tools. `remimem memory list/add/rm` do the same from the command line.
- Acceptance added by the owner on 2026-11-14: the MCP Inspector lists all nine tools. An automated test asserts the same list through the protocol; the Inspector itself is run by the owner.
- Coverage threshold now includes `memory`.

### Phase 7

- Quick change detection: a file whose size is unchanged and whose modification time is older than the last look is taken as unchanged without reading it. `remimem index` still hashes every file; the quick mode serves tool calls and `watch`.
- Auto-refresh: the MCP server runs a quick re-index before every tool call except `index_status`, waits at most 2 seconds, and otherwise answers from the current index with a note. A server with no index builds one on the first call.
- `remimem search` and `remimem context` run the same quick check before answering, and wait for it to finish.
- A file modified within 2 seconds before the last scan, or any time after it, is always hashed, so an edit in the same second as a scan is not skipped.
- `remimem watch` (chokidar, debounced by `watch.debounceMs`) and `remimem stats` (queries, tokens served, estimated baseline, estimated saving, per tool).
- `query_log` table: one row per tool call from the MCP server, `remimem context`, and `remimem memory`.
- `remimem index --full` prunes cached vectors that no chunk uses.
- `remimem doctor` reports index health: files, chunks, pending changes, chunks without a vector.
- Config: `watch.debounceMs` and `telemetry` (always `false`).
- Measured on nest (277k lines, 2,797 files, Apple M5, 2026-11-14): a 20-file change re-indexes in 2.0s end to end (target under 3s); the quick check with nothing changed takes about 30 ms; `get_context` including that check runs at p50 56 ms and p95 65 ms.

### Phase 8

- Benchmark harness (`remimem bench`): three pinned repos (hono, httpx, echo), 108 tasks mined from real commits (72 training, 36 test), a grep-and-read baseline, `search_code` and `get_context` at three budgets, seven ablations, tuning on the training split, a results file per run, and a generated README section. `--compare` checks a rerun against a results file within a tolerance; `--e2e` is the opt-in agent run and has never been executed.
- Test split (36 tasks), `get_context` at 4,000 tokens against the baseline (2026-11-15, Apple M5, 16 GB, Node.js 24.20.0, results file `bench/results/2026-11-15-9e63d69.json`). Tokens: 3,827 served per call on average against 27,529 read by the baseline, with the baseline's misses counted at its 40,000-token cap (86% fewer); charging remimem the same cap for its own incomplete answers gives 6,854 (75% fewer). Recall@10, the share of a task's ground-truth files among the ten best-ranked files: 0.93 against 0.79. File recall in the answer: 93% against 60%, and 92% when only a full body counts. Symbol recall 74% against 57%, MRR 0.61 against 0.40.
- Without httpx `cabd1c095e`, the test task inspected before tuning (35 tasks): 3,823 against 27,535 tokens (86% fewer; 6,937 and 75% with remimem's misses at the cap), recall@10 0.93 against 0.79, file recall 93% against 59%, full-body file recall 92%.
- Settings changed by tuning on the training split: `retrieval.textFileWeight` 0.25 (new; file recall 81.5% to 89.4% on training) and `retrieval.memoryMinSimilarity` 0.4 (was 0.3). Left unchanged because the differences were within about one task: `rrfK`, the symbol weight, `contextK`, `maxChunksPerFile`, `neighborBudgetShare`.
- Name-match edges: the ablation does not show that they help. Removing them changed training file recall by one task (89.4% to 88.1%) and left test file recall unchanged, which is within noise for sets this small. They remain at the spec's weight of 0.2 pending a decision.
- Embedding models on the test split: `Xenova/all-MiniLM-L6-v2` 93% file recall, recall@10 0.93, MRR 0.61, 62s to index all three repos; `jinaai/jina-embeddings-v2-base-code` 92%, 0.93, MRR 0.65, 324s. The default stays MiniLM.
- Memory ablation (60 unlinked memories per repo, from older commit subjects): 2.4 attached per task on the test split, 25% of them relevant, 54% of tasks with a relevant memory get one; file recall is unchanged with memories on (full-body file recall 90% against 92%).
- hono's TypeScript config has no `paths` or `baseUrl`, so path alias support was not added.

Success metrics from the spec, as measured:

| Metric                                               | Target             | Measured                                                                                                                                           |
| ---------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens to reach the right code, against the baseline | at least 40% fewer | 86% fewer per task (3,827 served against 27,529, baseline misses at its cap); 75% fewer when remimem's incomplete answers are also charged the cap |
| Retrieval recall@10                                  | at least 0.80      | 0.93 (share of a task's ground-truth files in the ten best-ranked files, mean over 36 test tasks; baseline 0.79)                                   |
| Full index of a 100k-line repo, local embeddings     | under 3 minutes    | 38s (hono, 99k lines)                                                                                                                              |
| Incremental re-index after a change under 20 files   | under 3 seconds    | 0.97s on hono from the command line, 2.0s on nest (277k lines)                                                                                     |
| Query latency p95, warm index                        | under 300 ms       | 35 ms in the benchmark; 65 ms on nest including the change check                                                                                   |
| Install to first answer                              | under 2 minutes    | 26s from empty caches                                                                                                                              |

### Phase 9

- Renamed the project to remimem, as its own commit, after `npm view` showed the working name was taken on npm (decision 036).
- README in the order the spec gives: pitch, benchmark, install, client configuration, how it works with a diagram, tool reference, configuration, privacy, limitations, roadmap, contributing.
- `CONTRIBUTING.md` (including how to add a language), issue and pull request templates, `CHANGELOG.md`, `RELEASING.md`, release notes in `docs/releases/v0.1.0.md`, and package metadata (description, keywords, homepage, bugs).
- A release workflow that is started by hand and publishes with provenance. It has not been run.
- The package contains 38 files: `package.json`, `README.md`, `LICENSE`, `dist/` without the benchmark, and `grammars/`.

Release checklist:

| Item                                                                                     | State                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| README sections in order                                                                 | Done                                                                                                                                         |
| Demo GIF                                                                                 | Done: `docs/demo.gif`, 26 seconds, recorded from `docs/demo.tape` with VHS 0.12.1 on 2026-11-15                                              |
| Install in one line, client configurations                                               | Done                                                                                                                                         |
| How it works, tool reference, configuration, privacy, limitations, roadmap, contributing | Done                                                                                                                                         |
| `CONTRIBUTING.md` with how to add a language                                             | Done                                                                                                                                         |
| Issue and pull request templates                                                         | Done                                                                                                                                         |
| `CHANGELOG.md`, version 0.1.0                                                            | Done                                                                                                                                         |
| Publish command with provenance, release notes, repo topics, in `RELEASING.md`           | Prepared, not performed                                                                                                                      |
| Package contents                                                                         | Checked with `npm pack --dry-run`; `npm publish --dry-run` was not run by the build, to stay clear of the rule against running `npm publish` |

## Next

Release, by the repository owner: rename the GitHub repository, record the demo, then follow `RELEASING.md`. Nothing has been published, tagged, or released.

## Notes for later phases

## Known issues

- The GitHub repository is still named by the old working name; links in the docs point at the new name and resolve once the owner renames it.

- The default embedding model is a small general-purpose model, not a code-trained one. On the benchmark the code-trained alternative did not find more files and indexed 5.5 times slower (decision 016, updated).
- The OpenAI and Voyage providers are tested against a stubbed HTTP server only, not the live services (no API key was used).
- Install size: `@huggingface/transformers` brings about 430 MB of ONNX runtime files into `node_modules`.
- Cached vectors of chunks that were edited away are pruned only by `remimem index --full`.
- Each vector is stored twice (search table and cache), which adds about 1.5 KB per chunk.
- `sqlite-vec` has no prebuilt extension for Windows on ARM.
- Benchmark limits: task text is the commit message, written after the change; the test split has 36 tasks; the baseline is a simulation. One test task was inspected while debugging the harness, before tuning.
- In the memory ablation only a quarter of attached memories were relevant. The keyword threshold made no difference there, because commit subjects are short; it is untested on longer memories.
- httpx is the weakest repo (83% file recall): its two total misses are tasks whose message names nothing found in the changed files.
- `memory.json` has one memory per line, sorted by id, so most concurrent additions merge cleanly. Two additions that land next to each other, or after the last line, can still conflict; a broken file is refused rather than loaded.
- Quick change detection trusts size and modification time. A change that keeps both is missed until `remimem index` runs; this is the same trade git makes.
- The `stats` baseline assumes an agent would read in full every file a result body came from, so the saving it shows is an upper bound, not a measurement.
- The MCP Inspector check and the manual run in Claude Code are documented in SETUP.md but were not run by the build agent; the same protocol paths are covered by automated tests.
- `remimem index` creates `.remimem/` but only `remimem init` adds the index to `.gitignore`.
- Only the tables in use exist so far. Edges, memories, and the query log arrive as migrations in the phases that use them.
- Without git, `.gitignore` is not honored; only the built-in excludes apply.
- Call resolution has no type inference: `user.save()` resolves only when one symbol in the repo is named `save`. On real code about one in four name-match edges is wrong (see the hand-check above); they carry the lowest retrieval weight (0.2).
- The graph is rebuilt in full after every index run that changed a file (0.7s on nest).
- Go struct embedding and implicit interface satisfaction produce no edges. TypeScript path aliases from `tsconfig.json` are not read; a non-relative import resolves only when exactly one file matches it.
- Class header chunks are never split, even for very large classes.
- `npm audit` reports moderate advisories for `minimatch`, pulled in by ESLint 10 and typescript-eslint 8. These are development tools only and are not part of the published package. No fixed release was available on 2026-11-12.
