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
- **Consequences:** `remimem search normalize` still returns the function first; "how to resolve a route" relies on keyword ranking instead.

## 013: Schema built up by migrations, one phase at a time

- **Context:** The data model lists ten tables; Phase 2 uses five.
- **Decision:** Migration 1 creates `meta`, `files`, `symbols`, `chunks`, and `chunks_fts`. Later phases append migrations for vectors, edges, memories, and the query log. `symbols` has an extra `docstring` column, which signature compression needs in Phase 3. A separate `index_format` value in `meta` forces a full reindex when the parser or chunker changes what is stored.
- **Consequences:** No empty, untested tables. Existing indexes upgrade in place.

## 014: Token counts use the o200k_base encoding

- **Context:** Budgets need a token count per chunk. Different models tokenize differently.
- **Decision:** Count with `js-tiktoken` and the `o200k_base` encoding, and describe every count as approximate.
- **Consequences:** Counting 1 MB of code takes about 0.14s, so it does not need caching.

## 015: Development needs npm 11 or newer

- **Context:** `better-sqlite3` 13 ships prebuilt binaries inside the package. When npm installs it from a lockfile, npm (10 and 11 alike) still runs an implicit `node-gyp rebuild`. The package makes that a no-op when a prebuilt binary exists, but node-gyp must first find a C++ toolchain. npm 10 bundles node-gyp 11.5, which does not recognize the Visual Studio version on the Windows CI runner, so `npm ci` failed there on Node 22. npm 11 bundles node-gyp 12, which does. Installing from the registry without a lockfile does not run node-gyp at all (checked with npm 10.9.10 and 11.19.0).
- **Options:** (a) install with `--ignore-scripts` and build by hand, (b) go back to `better-sqlite3` 12, which downloads its binary in an install script, (c) require npm 11 for working on this repo.
- **Decision:** (c). CI upgrades npm before `npm ci`, and SETUP.md lists npm 11 as a prerequisite.
- **Consequences:** People who install the published package are not affected, since that path has no lockfile. Contributors on Node 22 must upgrade npm once. A Windows contributor with no Visual Studio at all would still fail on the lockfile install and needs `npm ci --ignore-scripts` followed by `npm run prepare`.

## 016: Default embedding model

- **Context:** The spec asks for a local model that is code-aware and small enough for a laptop, and a full index of a 100k-line repo in under 3 minutes. Measured on an Apple M5 with 8-bit quantized ONNX weights, inputs cut to 256 tokens, and batches sorted by length:

  | Model                                 | Trained on code | Download | Dimensions | Chunks per second |
  | ------------------------------------- | --------------- | -------- | ---------- | ----------------- |
  | `Xenova/all-MiniLM-L6-v2`             | no              | 23 MB    | 384        | about 200         |
  | `jinaai/jina-embeddings-v2-base-code` | yes             | 163 MB   | 768        | about 42          |

  No smaller code-trained model with ONNX weights from an established publisher was found on the model hub. A 100k-line repo is about 6,000 chunks: roughly 30 seconds with the first model and 2.4 minutes with the second on this machine, which leaves no margin on slower laptops.

- **Decision:** Default to `Xenova/all-MiniLM-L6-v2`. The jina model is a documented config option.
- **Consequences:** The default is not code-aware, which the spec asked for. On the fixtures it still finds functions from descriptions that share no keywords. The Phase 8 benchmark should run both models so the choice rests on measured recall.
- **Update, 2026-11-15:** The benchmark ran both on the test split with `get_context` at 4,000 tokens. MiniLM: file recall 93%, symbol recall 74%, recall@10 0.93, MRR 0.61, 62s to index the three repos. Jina: 92%, 74%, 0.93, 0.65, 324s. The code-trained model ranks the first right file a little higher but finds no more of them, so the default stays.

## 017: Vector storage and the embedding cache

- **Context:** A `sqlite-vec` table has a fixed dimension, and the spec forbids mixing models.
- **Decision:** `chunk_vectors` is created when the first vector arrives, with that vector's dimension, and `meta` records the model. A different configured model makes `index` and `search` fail with an instruction to run `remimem index --full`, which drops and rebuilds the table. Embedding runs after chunks are written and only for chunks that lack a vector, so an interrupted run resumes. The embedded text is the path, the signature, the docstring, and then the body, in that order, with the doc comment and signature removed from the body so nothing is repeated; a model that cuts its input therefore only loses the end of the body. The cache table is keyed by a hash of that text and the model id.
- **Consequences:** Keyword search works while embedding is still running or after it fails. Vectors are stored twice. Cached vectors of chunks that were edited away are not pruned yet.

## 018: Packer rules

- **Context:** The spec fixes the outline (score order, signature compression, dedupe, greedy fill, grouped output, footer) and leaves details open.
- **Decision:**
  - Block header: `--- path:start-end kind name [reasons]`. Blocks of one file are adjacent and in line order; files are ordered by their best score.
  - Chunks of a file that overlap or touch are joined into one block without repeated lines. Class headers and signature-only blocks are never joined, because their text is not a plain slice of the file.
  - An item that does not fit in full is tried as signature-only before it is dropped.
  - Selection uses per-item token estimates; the final text is then measured, and items are removed until it fits. 24 tokens are reserved for the footer, and the footer's token figure includes the footer itself.
  - A budget too small even for the footer yields an empty string.
- **Consequences:** The budget is a hard limit, checked by a seeded property test over 400 random inputs. Estimates are slightly conservative, so a few tokens of budget can go unused.

## 019: No property-testing library

- **Context:** The acceptance criteria ask for a property-based test of the budget limit.
- **Decision:** A seeded pseudo-random generator inside the test, rather than adding `fast-check`.
- **Consequences:** No new dependency. There is no automatic shrinking; a failure reports the iteration, budget, and item count for replay.

## 020: How the graph is stored

- **Context:** The spec lists one `edges` table with the kinds `calls`, `imports`, `extends/implements`, and `contains`. Resolving a name depends on every file in the repo, and `find_references` needs each call site, not one row per pair of symbols.
- **Decision:**
  - `refs` holds what the parser saw (kind, name, receiver, line, enclosing symbol) plus the resolved target and confidence. `imports` holds each import binding (source, name, local name) plus its resolved target.
  - `edges` is derived from `refs`: one row per source, target, and kind (`calls`, `extends`, `implements`, `uses-type`), with the best confidence among the references behind it.
  - `contains` is not copied into `edges`; it is `symbols.parent_id`. Imports are not edges either, because the importer is a file, not a symbol; `find_references` reads them from `imports`.
  - The whole graph is resolved again after any index run that changed a file.
- **Consequences:** Incremental indexing stays correct without tracking which edges a change could affect, at a cost of 0.7s on a 277k-line repo. `uses-type` is an extra edge kind, added because the spec's graph expansion asks for referenced types.

## 021: Resolution rules

- **Context:** The spec gives the order: same file, imported names, unique name in the repo.
- **Decision:**
  - A bare call looks in the enclosing functions, then the file's top level, then (Go) the other files of the package, then the file's imports.
  - `this.x()`, `self.x()`, and `cls.x()` look in the enclosing class. `Name.x()` looks in a same-file class or an imported class or module of that name.
  - A reference through an import that leads outside the repo (`fmt.Println`, `crypto.timingSafeEqual`) is left unresolved and never falls back to a name match.
  - A call on any other expression resolves to the only symbol of that name in the file (`exact`), or failing that the only one in the repo within the same language family (`name-match`). Functions nested in other functions and constants are not name-match candidates.
  - A call on a capitalized receiver that is neither defined in the file nor imported (`Object.assign`, `Math.max`) is left unresolved: it names a global, not a repo symbol. Added after a hand-check on nest found such calls behind half of the wrong name-match edges.
  - Type references and base classes resolve only to classes, interfaces, types, and enums.
- **Consequences:** Precision is favored over recall: an ambiguous name produces no edge. `name-match` edges are the least certain and carry the lowest weight (0.2) in retrieval.

## 022: Graph expansion details

- **Context:** The spec asks for the 1-hop neighbors of the top 10 results, scored as parent score times edge weight, capped at 20.
- **Decision:** Neighbors are callers, callees, base and derived classes, implemented interfaces, referenced types, and the enclosing class. Users of a type and members of a class are not added, since both can be very many. A neighbor that is already a search result keeps its place and only gains the reason. A function nested inside a result is skipped because the result's text already contains it. Neighbors are always shown as signature and docstring.
- **Consequences:** Because an exact symbol match scores above 1, its neighbors (0.2 to 0.5) rank above ordinary fused results (about 0.03) and are packed first; they are short, so this costs little budget.

## 023: Memory tools are registered in Phase 6, not Phase 5

- **Context:** Phase 5 asks for all tools; `remember`, `recall`, and `forget` depend on the memory module, which is Phase 6.
- **Options:** (a) register the three tools now with handlers that say memory is not available, (b) register them when they work.
- **Decision:** (b). Phase 5 ships the six tools that have an implementation.
- **Consequences:** An agent never sees a tool that cannot do its job. The tool list grows from six to nine in Phase 6.

## 024: Client configuration formats

- **Context:** `remimem init` prints copy-paste configuration. Checked against each client's documentation on 2026-11-14.
- **Decision:** Claude Code: `claude mcp add remimem -- <command>` or a project `.mcp.json` with `mcpServers`. Cursor: `.cursor/mcp.json` with `mcpServers`. VS Code: workspace-root `.mcp.json` with `mcpServers` and `"type": "stdio"`, which its documentation now names as the format to use; the older `.vscode/mcp.json` with a `servers` key is printed as well for versions that predate it. The command is `npx -y remimem serve` when remimem runs from an installed package and `node <path>/dist/cli/index.js serve` from a source checkout.
- **Consequences:** One `.mcp.json` serves both Claude Code and VS Code. The printed command contains an absolute path when run from a checkout, so that file should not be committed in that case.

## 025: Server behavior

- **Context:** Details the spec leaves open.
- **Decision:**
  - `serve` works on its current directory or `--root`, reads the config once at start, and keeps one database connection open.
  - `search_code` filters by language and path globs after ranking, looking up to ten times further down the ranking when a filter is set.
  - `get_context` considers `retrieval.contextK` results (default 20) and lets the budget decide how many are shown.
  - Tools other than the two search tools end with a `~N tokens` line.
  - The overview lists only top-level symbols that something refers to, and reduces depth and symbols per directory until it fits 1,500 tokens.
- **Consequences:** A config change needs a server restart. Filters can return fewer than `k` results when matches are rare.

## 026: Memory design

- **Context:** The spec gives the tables, the tools, the JSON mirror, and staleness by content hash. Open points: ids, which side wins when file and database differ, what a link hashes, and how memories enter `get_context`.
- **Decision:**
  - Ids are random text (`m_` plus eight hex digits), not integers, so memories written on two machines do not collide when the file is merged.
  - `.remimem/memory.json` is the source of truth. Every command that touches memory first compares the file's hash with the one recorded in `meta` and reloads the file when it differs. A file that does not parse or validate is refused and the database is left alone.
  - A symbol link stores a hash of the symbol's chunk text; a file link stores the file's content hash. Staleness is recomputed after every index run and is not written to the file, since it depends on the checkout.
  - Memory vectors live in a column of `memories` and are compared in JavaScript: there are few memories, so no vector table is needed.
  - Matching a memory to a query uses the same keyword and vector fusion as code search, with a minimum on at least one side: the memory contains at least `retrieval.memoryMinKeywordMatch` (default half) of the query's terms, or its cosine similarity is at least `retrieval.memoryMinSimilarity` (default 0.3). Rank fusion alone has no notion of "not relevant", so without the minimum any shared word made a match.
  - `get_context` attaches a memory automatically only when it is linked to a result's file as a whole, or to a symbol that is itself in the results. A memory linked to another symbol of that file has to match the task like any other. Then come matching memories (at most `retrieval.memoryLimit`), stopping at a quarter of the budget. `search_code` does not add memories.
  - `memory.json` is written sorted by id with one memory per line, so concurrent additions usually touch different lines and merge cleanly.
  - `symbols` passed to `remember` must resolve to exactly one symbol; anything else is stored unlinked and reported back.
- **Consequences:** Deleting the index or pulling a teammate's file needs no extra step. The table has two extra columns (`embedding`, `embedding_model`) beyond the spec. A whole-file memory is attached whenever that file appears in results, relevant or not; that is what a whole-file link means. The two minimums are first guesses, to be checked by the Phase 8 memories ablation.

## 027: Change detection by size and modification time, not `git diff`

- **Context:** The spec asks for a hash diff with `git diff --name-only` as a fast path, and for a re-index check before every tool call. Measured on nest (2,797 files, warm disk cache): listing files through git 21 ms; `lstat` of every file 3 ms; reading and hashing every file 57 ms; `git diff --name-only HEAD` 61 ms, before the extra commands needed for untracked files and for commits since the last index.
- **Options:** (a) `git diff` fast path, (b) compare each file's size and modification time with what the index recorded, and hash only files that differ.
- **Decision:** (b). It is faster than `git diff` at this size, works outside git, and needs no bookkeeping about commits, dirty files, or rebases. A file modified within 2 seconds of the last look is hashed rather than trusted, to cover coarse timestamps. `remimem index` keeps hashing every file, so the exhaustive check is one command away.
- **Consequences:** The quick check costs about 30 ms on a 277k-line repo. A change that keeps both size and modification time is missed by the quick check, as it would be by git's own index. `git diff` is not used at all, which departs from the spec.

## 028: Auto-refresh and the query log

- **Context:** Details the spec leaves open.
- **Decision:**
  - One refresh runs at a time per server; concurrent tool calls wait on the same one. After 2 seconds a call stops waiting, the refresh continues in the background, and the answer ends with a note that costs 20 tokens of the budget.
  - `index_status` does not refresh, so it can report pending changes.
  - The baseline of a query is the token count of every whole file that a full result body came from. Files that contributed only a signature do not count, and tools that return no code (references, memory, status) log a baseline equal to what they served.
  - The query text is stored (up to 500 characters) in the local index only.
- **Consequences:** The saving in `remimem stats` is an upper-bound estimate with a stated definition; the measured numbers come from `remimem bench`.

## 029: chokidar 5, not 6

- **Context:** chokidar 6 requires Node.js 22.22 or newer; the project minimum is 22.13.
- **Decision:** Use chokidar 5 (Node.js 20.19 or newer).
- **Consequences:** One major behind. Move to 6 if the minimum Node.js version is raised.

## 030: Benchmark repositories and tasks

- **Context:** The spec asks for one permissively licensed repo each in TypeScript, Python, and Go, 20k to 200k lines, with 25 to 40 tasks each taken from real history.
- **Decision:** hono (MIT, 99k lines), httpx (BSD-3-Clause, 33k), and echo (MIT, 50k), pinned in `bench/repos.json`. Six candidates were mined; these three had dense, descriptive first-parent history. Each task is one of the 36 most recent commits that is not by a bot, does not look like a chore, docs, CI, test, or release commit, touches at most eight files, and modifies at least one existing non-test source file. Task text is the commit message with trailers removed; em dashes and emojis are replaced because this repo bans them in tracked files. Ground truth is the modified non-test source files, plus the symbols of the parent tree whose lines the commit changed. Every third task in commit order is in the test split.
- **Consequences:** Tasks need no network API and are frozen in `bench/tasks`. Commit messages are written after the change and sometimes name the changed code, which makes tasks easier than bug reports. Files a commit adds are not ground truth, since they do not exist in the tree being searched. hono has no `paths` in its TypeScript config, so path alias support was not needed.

## 031: The baseline is simulated in process

- **Context:** The spec's baseline extracts keywords, runs ripgrep, and reads whole matching files in rank order up to 40,000 tokens.
- **Decision:** The same procedure, done in process instead of by calling `rg`: up to eight keywords (identifier-like words first, then the longest), a case-insensitive whole-word count per file, files ranked by distinct keywords matched and then by total matches, read in full until every ground-truth file is read or the cap is reached. It searches the same file set remimem indexes.
- **Consequences:** No ripgrep install is needed and the result is deterministic. It is a model of an agent, not an agent.

## 032: Benchmark metrics

- **Decision:**
  - A file or symbol counts as present when a block of the answer comes from that file or overlaps the symbol's lines, including signature-only blocks. For the baseline, every file it read and every symbol in those files.
  - The token headline compares, over every test task, the mean tokens remimem serves per call with the mean the baseline reads, where a task on which the baseline did not read every ground-truth file counts as its full 40,000-token cap. A second figure charges remimem the same cap for each answer that lacks a ground-truth file. Tokens to first hit (reading order, through the first block from a ground-truth file) is kept as a table column, not a headline: it is a median over the tasks each strategy solved, which are different sets.
  - Recall@10 is the share of a task's ground-truth files among the ten best-ranked files, averaged over tasks. Hit@10 (any one of them) is recorded but not reported as recall.
  - A strict column counts a file only when a full body from it is shown.
  - Recall@10 and MRR use the ranking before packing: distinct files by best score.
  - Results record the machine. `--compare` allows 0.05 on recall figures and 15% on tokens, because the quantized embedding model gives slightly different vectors on different CPU types.
- **Consequences:** Counting a signature-only block as present is generous to remimem on file recall; symbol recall and the no-compression ablation show the other side.

## 033: What tuning changed

- **Context:** Settings were tried one at a time on the 72 training tasks with `get_context` at 4,000 tokens, in three rounds.
- **Decision:**
  - New setting `retrieval.textFileWeight`, default 0.25: chunks of files that are not parsed as code score a quarter. Changelogs and docs were taking most of the top results for commit-message queries. Training file recall 81.5% to 89.4%, symbol recall 69.5% to 73.9%.
  - `retrieval.memoryMinSimilarity` 0.3 to 0.4: memory precision 29% to 38%, memory recall 74% to 60%, the best balance of the two in the grid.
  - Tried and left at their defaults, because the differences were about one task either way: `rrfK` (20, 120), symbol weight (2, 10), `contextK` (10, 40). `neighborBudgetShare` (a share of the budget kept for neighbor signatures) helped before the text weight was added and not after, so it defaults to 0. `maxChunksPerFile` at 2 raised file recall to 92.4% but lowered symbol recall to 69.2%, so it defaults to off.
  - Name-match edges: no evidence either way. Removing them changed training file recall by one task (89.4% to 88.1%) and nothing on test file recall. The weight stays at the spec's 0.2; this is not a finding that they help.
- **Consequences:** Three settings exist mainly so the benchmark can vary them. One test-split task (httpx `cabd1c095e`) was inspected while the harness was being debugged, before any tuning; it is what pointed at changelog chunks. The setting was then chosen on the training split, but that task is not a clean test case.

## 034: The memory ablation

- **Context:** The benchmark repos have no project memories.
- **Decision:** For each repo, the 60 qualifying commits older than its tasks become memories whose text is the commit subject. They are stored without links, so they must match the task on their own. A memory counts as relevant to a task when its commit touched one of the task's ground-truth files.
- **Consequences:** On the test split 25% of attached memories are relevant and code recall is unchanged. Commit subjects stand in for real decisions and conventions, so this measures the matching rule, not the value of memory.

## 035: Where the benchmark code lives

- **Decision:** `src/bench/` is compiled with everything else and left out of the npm package by a `!dist/bench` entry in `files`. The data (`repos.json`, tasks, memories, results) is in the top-level `bench/` directory, which is not packaged either. `remimem bench` loads the code on demand and explains itself when it is absent.
- **Consequences:** One build, no second compiler config. The published CLI has a `bench` command that only works from a checkout.

## 036: The project is named remimem

- **Context:** The project was built under the working name codemem. Before release prep, `npm view codemem` showed that name is taken on npm by an unrelated, active package with a similar purpose. The setup command would have printed `npx -y codemem serve`, which would have run that other package.
- **Options:** (a) publish under a suffixed name and keep the project name, (b) rename everything.
- **Decision:** (b), by owner decision on 2026-11-15: remimem. The package, the binary, the `.remimem/` directory, the `REMIMEM_*` environment variables, the MCP server name, the `remimem://overview` resource, the model and benchmark cache under `~/.cache/remimem`, the docs, and the repository links all use the new name. `remimem` was free on npm on that date.
- **Consequences:** Earlier entries in this file were written under the old name and have been updated to the new one. An index made before the rename, in a `.codemem/` directory, is not picked up; run `remimem init` again. The GitHub repository has to be renamed by its owner for the links to resolve.

## 037: Release preparation

- **Context:** Phase 9 prepares a release without performing one.
- **Decision:**
  - Publishing is a workflow started by hand (`.github/workflows/release.yml`), because npm provenance can only be produced by a CI run. Version 0.1.0 was published with `npm publish --provenance --access public` and an `NPM_TOKEN` secret. The workflow has since moved to trusted publishing: no stored token, provenance attached automatically, and a final step that waits until the exact version can be read back from npm.
  - The order is publish, confirm the exact version is live, then tag and release. During the 0.1.0 release npm showed a placeholder version for about two minutes after the publish, and a check that accepted any version let the tag and release be created early.
  - Package contents were checked with `npm pack --dry-run`, which lists the same files as `npm publish --dry-run`, so that no form of `npm publish` was run by the build.
  - The demo is scripted for VHS in `docs/demo.tape` and recorded to `docs/demo.gif` once the owner allowed installing VHS on the build machine.
  - VS Code setup in the README shows the workspace-root `.mcp.json` with `mcpServers` first and `.vscode/mcp.json` as the older format, following VS Code's own documentation (decision 024).
- **Consequences:** The end-to-end benchmark hook has never been executed, and says so where it lives.
