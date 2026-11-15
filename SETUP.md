# Setup

How to set up, run, and test remimem from a fresh machine. This file is updated at the end of every phase. Sections for features that do not exist yet say which phase adds them.

## Prerequisites

| Tool    | Version                                                                                    | Check            |
| ------- | ------------------------------------------------------------------------------------------ | ---------------- |
| Node.js | 22.13.0 or newer (CI tests 22 and 24)                                                      | `node --version` |
| npm     | 11 or newer for working on this repo. Node.js 22 ships npm 10: run `npm install -g npm@11` | `npm --version`  |
| Git     | 2.30 or newer                                                                              | `git --version`  |

Normally no compiler or other build tools are needed: the tree-sitter grammars ship in the repo as WebAssembly files under `grammars/`, and `better-sqlite3` downloads a prebuilt binary for common platforms. If no prebuilt binary exists for your platform, `npm install` compiles it and needs Python 3 and a C++ toolchain (see Troubleshooting).

The npm 11 requirement applies only to a checkout of this repo. The packaged tarball installs and runs with the npm 10 that ships with Node.js 22; CI checks that on every push.

The first `remimem index`, `remimem doctor`, or `npm test` downloads the default embedding model (about 23 MB) from huggingface.co into `~/.cache/remimem/models`. Set `REMIMEM_CACHE_DIR` to keep it elsewhere. After that no network access is needed.

OS notes:

- macOS and Linux: nothing extra.
- Windows: use PowerShell, cmd, or Git Bash. The repo forces LF line endings through `.gitattributes`, so no Git line-ending setting is needed.

## Install and build

```sh
git clone https://github.com/JaswanthRemiel/remimem.git
cd remimem
npm install
```

`npm install` also builds the project into `dist/` and enables the pre-commit hook (it sets `core.hooksPath` to `.githooks`). To rebuild later, run `npm run build`.

## Lint, typecheck, and test

```sh
npm run lint
npm run format:check
npm run typecheck
npm run check:chars
npm test
npm run coverage
```

Expected: every command exits with code 0. `npm run check:chars` prints `check-chars: N tracked files clean`. `npm test` builds first, then ends with `Test Files  15 passed (15)`. `npm run coverage` runs the same tests, prints a coverage table, and fails if line coverage of `src/parser`, `src/chunker`, `src/retriever`, `src/packer`, `src/graph`, or `src/memory` drops below 80%.

## Run the CLI

```sh
npx . --version
npx . doctor
```

Expected output:

```text
0.1.0
Node.js: 22.x.x ok
Grammar javascript: ok
Grammar typescript: ok
Grammar tsx: ok
Grammar python: ok
Grammar go: ok
SQLite with FTS5 and sqlite-vec: ok
Embedding model: local:Xenova/all-MiniLM-L6-v2 ok (384 dimensions)
Index: none yet (run `remimem init` in the project)
```

The Node.js line shows your own version. In an indexed project the last line reads like `Index: 8 files, 39 chunks, 0 pending changes, 0 chunks without a vector`. A failed check prints `failed (...)` with a fix hint, and `doctor` exits with code 1.

## Inspect how a file is chunked

`debug chunks` is a hidden developer command. Paths are relative to the current directory and must stay inside it.

```sh
cd test/fixtures/go-mod
npx ../../.. debug chunks store.go
```

Expected output starts with:

```text
store.go:1-20  window
store.go:21-22  type Key
  Key string
store.go:24-28  class Entry
  Entry struct
```

Add `--content` to print each chunk's text. Pass a directory to scan and chunk everything under it and print totals:

```sh
npx ../../.. debug chunks .
```

Expected: `3 files, 110 lines, 16 symbols, 15 chunks in 0.0Xs` (the time varies).

## Index a sample repo and query it

Work on a copy of a fixture so the index does not land inside this repo. Run these from the remimem checkout:

```sh
REMIMEM=$(pwd)
rm -rf /tmp/remimem-demo && cp -R test/fixtures/ts-app /tmp/remimem-demo
cd /tmp/remimem-demo
node "$REMIMEM/dist/cli/index.js" index
node "$REMIMEM/dist/cli/index.js" index
node "$REMIMEM/dist/cli/index.js" search authenticateUser -k 1
node "$REMIMEM/dist/cli/index.js" search "confirm sign-in credentials" -k 3 --budget 150 --debug
```

On Windows PowerShell, replace the first three lines with:

```powershell
$REMIMEM = (Get-Location).Path
Copy-Item -Recurse -Force test/fixtures/ts-app $env:TEMP/remimem-demo
Set-Location $env:TEMP/remimem-demo
```

and use `node "$REMIMEM/dist/cli/index.js"` the same way.

Expected output (times vary):

```text
Indexed 7 of 7 files (0 unchanged, 0 removed) in 0.49s. Embedded 38 chunks (0 from cache) with local:Xenova/all-MiniLM-L6-v2. Index: 7 files, 32 symbols, 38 chunks.
Indexed 0 of 7 files (7 unchanged, 0 removed) in 0.01s. Embedded 0 chunks (0 from cache) with local:Xenova/all-MiniLM-L6-v2. Index: 7 files, 32 symbols, 38 chunks.
```

The first search prints the function in full, then its neighbors in the call graph as signatures, each with the reason it is there:

```text
--- src/auth.ts:10-23 function authenticateUser [exact-symbol, keyword, vector]
/**
 * Checks a password against the stored hash.
(the rest of the function)

--- src/db.ts:19-21 function findUser [called by authenticateUser] (signature only)
export const findUser = (id: UserId): User | undefined =>
  Looks up a user by id.

--- src/hash.ts:4-10 function hash [called by authenticateUser] (signature only)
export default function hash(input: string): string
  Hashes a password with the fixture salt.

--- src/service.ts:33-38 method UserService.login [calls authenticateUser] (signature only)
@Log('login') async login(id: string, password: string): Promise<boolean>

~250 tokens | 4 results
```

The second search shares no word with the function it should find. `--debug` prints the ranking first: three search results, then graph neighbors (the lines with `vector=-`). The 150-token budget leaves room for one result:

```text
1. score=0.0164 keyword=- vector=1  src/auth.ts:10-23 authenticateUser
2. score=0.0161 keyword=- vector=2  src/auth.ts:36-39 resetPassword  (dropped)
3. score=0.0159 keyword=- vector=3  src/service.ts:33-38 UserService.login  (dropped)
4. score=0.0079 keyword=- vector=-  src/service.ts:8-12 Log  (dropped)
(seven more neighbors, all dropped)

--- src/auth.ts:10-23 function authenticateUser [vector, called by UserService.login]
(the function)

~134 tokens | 1 result | 10 dropped for budget
```

The index is a single file, `.remimem/index.db`, in the directory you indexed. `index --full` reindexes every file and is how you switch embedding models. Token counts are approximate.

Optional settings go in `.remimem/config.json`. Every field has a default; this example shows a few:

```json
{
  "include": ["src/**"],
  "exclude": ["**/*.test.ts"],
  "maxFileSizeKb": 512,
  "embedding": { "provider": "local", "model": "Xenova/all-MiniLM-L6-v2", "batchSize": 8 },
  "retrieval": { "rrfK": 60, "keywordLimit": 50, "vectorLimit": 50, "defaultBudgetTokens": 4000 }
}
```

- `embedding.provider`: `local` (default, nothing leaves the machine), `none` (keyword search only), or `openai` and `voyage`, which send your code to that service and read the key from `OPENAI_API_KEY` or `VOYAGE_API_KEY`.
- `embedding.model`: for a slower, code-trained local model use `jinaai/jina-embeddings-v2-base-code` (163 MB download), then run `remimem index --full`.
- `retrieval.textFileWeight` (default 0.25): how much a result from a file that is not parsed as code (Markdown, JSON, SQL) counts against one from code. Set it to 1 to rank documentation equally.
- `retrieval`: also `keywordWeights`, `defaultK`, and the graph settings `graphTopN` (how many top results get neighbors, 0 turns expansion off), `graphMaxNeighbors`, and `edgeWeights`.

## Inspect the call graph

Two hidden developer commands print what the MCP tools `get_symbol` and `find_references` return. Run them in the demo copy from the previous section:

```sh
node "$REMIMEM/dist/cli/index.js" debug symbol authenticateUser --depth 2
node "$REMIMEM/dist/cli/index.js" debug refs findUser
```

Expected: the first prints the function body, then these sections:

```text
Calls:
  authenticateUser.verify  src/auth.ts:16-18  [exact]
  findUser  src/db.ts:19-21  [import]
  hash  src/hash.ts:4-10  [import]

Called by:
  UserService.login  src/service.ts:33-38  [import]
    LegacyLogin.handle  src/legacy.js:6-8  [name-match]

Contains:
  authenticateUser.verify  src/auth.ts:16-18  [exact]
```

The tag is the confidence of the link: `exact` (same file or package), `import` (through an import), or `name-match` (the only symbol of that name in the repo). The second command prints:

```text
4 references in 2 files to function findUser at src/db.ts:19-21

src/auth.ts
  src/auth.ts:2  import
  src/auth.ts:20  call in authenticateUser [import]

src/service.ts
  src/service.ts:2  import
  src/service.ts:43  call in UserService.find [import]
```

`debug symbol` also takes `--signature` to print the signature instead of the body, and `--depth 0` to 2.

## Set up a project and get context from the CLI

`remimem init` does the whole setup for a project: it creates `.remimem/config.json`, adds the index to `.gitignore`, builds the index, and prints the client configuration shown in the next section. Run from the remimem checkout:

```sh
REMIMEM=$(pwd)
rm -rf /tmp/remimem-demo && cp -R test/fixtures/ts-app /tmp/remimem-demo
cd /tmp/remimem-demo
node "$REMIMEM/dist/cli/index.js" init
node "$REMIMEM/dist/cli/index.js" context "check a password at login" --budget 300
```

Expected: `init` starts with these lines and then prints the client configurations:

```text
Created .remimem/config.json (empty: every setting has a default).
Added .remimem/index.db* to .gitignore.
Privacy: everything runs on this machine. No code leaves it and there is no telemetry.
Indexed 8 of 8 files (0 unchanged, 0 removed) in 0.53s. Embedded 39 chunks (0 from cache) with local:Xenova/all-MiniLM-L6-v2. Index: 8 files, 32 symbols, 39 chunks.
```

(8 files rather than 7 because the new `.gitignore` is indexed too.) `context` prints what the `get_context` tool returns, so it can be pasted into any chat. Its first line is a block header such as `--- src/service.ts:33-38 method UserService.login [keyword, vector, ...]` and its last line is a footer such as `~265 tokens | 3 results | 24 dropped for budget`, never above the budget.

## Connect to Claude Code, Cursor, and VS Code

Clients start the server with `remimem serve`, which speaks MCP on stdin and stdout. It serves the directory it is started in, or the one given with `--root <dir>`. `remimem init` prints these configurations with the right command filled in. From a source checkout the command is `node <checkout>/dist/cli/index.js serve`; once the package is installed from npm it is `npx -y remimem serve`.

**Claude Code.** In the project directory run:

```sh
claude mcp add remimem -- node "$REMIMEM/dist/cli/index.js" serve
```

or create `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "remimem": { "command": "node", "args": ["/path/to/remimem/dist/cli/index.js", "serve"] }
  }
}
```

**Cursor.** Create `.cursor/mcp.json` in the project root with the same content.

**VS Code (Copilot).** Create `.mcp.json` in the workspace root with the same content plus `"type": "stdio"` in the server entry. VS Code versions that predate that file read `.vscode/mcp.json`, which uses a top-level `"servers"` key instead of `"mcpServers"`; `remimem init` prints both.

### Confirm the tools appear

Without any client, list the tools over the raw protocol (run in `/tmp/remimem-demo` after `init`):

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node "$REMIMEM/dist/cli/index.js" serve
```

Expected: two lines of JSON. The second lists nine tools: `get_context`, `search_code`, `get_symbol`, `get_file_outline`, `find_references`, `remember`, `recall`, `forget`, `index_status`.

With the MCP Inspector (downloads the inspector package on first use):

```sh
npx @modelcontextprotocol/inspector --cli node "$REMIMEM/dist/cli/index.js" serve --method tools/list
```

Expected: JSON with the same nine tools, each with an `inputSchema` of type `object`. Run `npx @modelcontextprotocol/inspector node "$REMIMEM/dist/cli/index.js" serve` instead to open the Inspector's web page and call tools by hand.

### Manual run in Claude Code

1. Run the `init` commands from "Set up a project and get context from the CLI".
2. In `/tmp/remimem-demo`, run `claude mcp add remimem -- node "$REMIMEM/dist/cli/index.js" serve`.
3. Start `claude` in that directory and enter `/mcp`. Expected: `remimem` is listed as connected with 9 tools.
4. Ask: `Call the remimem get_context tool with the task "check a password at login" and show me the raw result.`
5. Approve the tool call when asked. Expected: the tool result contains a block headed `--- src/auth.ts:10-23 function authenticateUser [...]` and ends with a `~N tokens | N results` footer.
6. Clean up with `claude mcp remove remimem`.

In Cursor the tools appear under Settings, MCP; in VS Code under Chat: Open Customizations, MCP Servers.

Logs go to stderr, never stdout. Set `REMIMEM_LOG_LEVEL` to `error`, `warn` (default), `info`, or `debug`.

## Keep the index fresh, and see what it saved

The MCP server checks for changed files before every tool call and re-indexes them first, so agents do not get stale code and there is no need to run `remimem index` by hand while a client is connected. The check compares file sizes and modification times, which takes a few milliseconds. If catching up takes longer than 2 seconds (after a branch switch, say), the tool answers from the index as it is and its last line says `(index refresh still running: results may not include your latest edits)`.

`remimem search` and `remimem context` run the same check before answering. A file modified within 2 seconds of the last scan is always read and hashed, so an edit made in the same second as a scan is not skipped.

Outside a client, `remimem watch` does the same continuously. Run in `/tmp/remimem-demo`:

```sh
node "$REMIMEM/dist/cli/index.js" watch
```

Expected: an `Indexed ...` line, then `Watching /tmp/remimem-demo for changes. Press Ctrl+C to stop.` Edit and save a file in another terminal and, half a second later, a line such as `Indexed 1 of 8 files (7 unchanged, 0 removed) in 0.35s.` appears. Stop it with Ctrl+C.

`remimem index` remains the thorough check: it reads and hashes every file, so it also catches a change that kept both the size and the modification time. `remimem index --full` rebuilds everything and removes cached vectors that are no longer used.

Every tool call is logged in the local index. After a few `remimem context` runs or MCP tool calls:

```sh
node "$REMIMEM/dist/cli/index.js" stats
```

Expected, with your own numbers:

```text
Queries served: 3 since 2026-11-14
Tokens served: ~1,120
Estimated baseline: ~3,400 tokens (reading in full every file a result body came from)
Estimated saving: up to ~2,280 tokens (67%)

By tool (queries, tokens served, estimated baseline, mean latency):
  get_context  3  ~1,120  ~3,400  45 ms

Token counts are approximate, and the baseline is an estimate, not a measurement: ...
```

On the small demo repo the saving is close to 0%, because a 4,000-token answer already holds most of the repo; the numbers above are from a larger one. The query log holds the text of each query. It stays in `.remimem/index.db` on your machine and is never sent anywhere.

## Project memory

Memories are short notes about the codebase (kinds: `decision`, `convention`, `gotcha`, `todo`) that agents save with the `remember` tool and see again at the top of `get_context` results. They can be linked to files and symbols. The same operations are available by hand. Run in `/tmp/remimem-demo` after `init`:

```sh
node "$REMIMEM/dist/cli/index.js" memory add "Passwords are hashed with the fixture salt; never store them in plain text." --kind decision --symbol hash --tag security
node "$REMIMEM/dist/cli/index.js" memory list
node "$REMIMEM/dist/cli/index.js" context "hash a password" --budget 400
```

Expected (the id is random):

```text
Stored memory m_20283783 (decision), linked to src/hash.ts hash.
[decision] m_20283783
  Passwords are hashed with the fixture salt; never store them in plain text.
  (linked: src/hash.ts hash; tags: security)

~39 tokens
```

and the `context` output now starts with:

```text
=== Project memory (decisions and conventions recorded for this repo) ===
[decision] m_20283783
  Passwords are hashed with the fixture salt; never store them in plain text.
  (linked: src/hash.ts hash; tags: security)
```

Memories are mirrored to `.remimem/memory.json`, sorted by id with one memory per line so that git merges stay clean. Commit that file to share them with a team; `.remimem/index.db` stays local. The file is the source of truth: a changed file (after `git pull`, or a hand edit) is loaded on the next command.

A memory is marked stale when code it is linked to changes. Edit the linked function, re-index, and list again:

```sh
sed -i.bak 's/total \* 31/total * 37/' src/hash.ts
node "$REMIMEM/dist/cli/index.js" index
node "$REMIMEM/dist/cli/index.js" memory list
```

Expected: the first line of the list is now `[decision] m_20283783 STALE: linked code has changed since this was written`.

Deleting the index does not lose memories:

```sh
rm .remimem/index.db*
node "$REMIMEM/dist/cli/index.js" index
node "$REMIMEM/dist/cli/index.js" memory list
```

Expected: the same memory is listed again. A memory linked to a whole file (`--path`) is shown whenever that file is in the results. One linked to a symbol is shown when that symbol is in the results. Otherwise it must match the task: at least half of the task's terms, or enough similarity in meaning (`retrieval.memoryMinKeywordMatch` and `retrieval.memoryMinSimilarity` in the config).

Other commands: `memory list "<query>"` searches, `memory list --kind todo` filters, `memory rm <id>` deletes, and `memory add` takes `--path <file>` as well as `--symbol` (both repeatable).

## Run the benchmark

The benchmark runs from a checkout of this repo, with one command. It needs network access the first time, to clone three repositories (about 150 MB) and download the embedding model, and no API key. It takes 5 to 10 minutes.

```sh
npx . bench
```

What it does:

1. Clones the repositories pinned in `bench/repos.json` into `~/.cache/remimem/bench` (set `REMIMEM_CACHE_DIR` to move it): hono (TypeScript), httpx (Python), and echo (Go).
2. For each of the 108 tasks in `bench/tasks/*.jsonl`, checks out the commit before the task's commit, brings the index up to date, and runs every strategy.
3. Prints a summary and writes `bench/results/<date>-<commit>.json` (every task's raw result) and a matching `.md` file.

Expected: a progress line per task (`hono 1/36 c3053ccf14 (train)`), then the summary that is also in the README: a headline, a table of the grep baseline against `search_code` and `get_context` at 2,000, 4,000, and 8,000 tokens, the ablations, a per-repository table, the worst misses, and the time to re-index after a 20-file change. The figures should be close to the README's; they differ slightly between CPU types because the quantized embedding model rounds differently. To check a run against a results file within a tolerance (0.05 on recall figures, 15% on tokens):

```sh
npx . bench --compare bench/results/<file>.json
```

Expected: a list of `ok` lines and exit code 0; a `DIFF` line and exit code 1 mean a headline figure moved by more than the tolerance.

Other options:

| Option            | What it does                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--repo <name>`   | Run one repository (repeatable). Prints the summary without writing a results file.                                                                                     |
| `--limit <n>`     | Run only the first n tasks of each repository, for a quick try. Prints the summary without writing a results file.                                                      |
| `--update-readme` | Paste the summary into `README.md` between the `bench:start` and `bench:end` markers.                                                                                   |
| `--tune`          | Also run the tuning configurations on the training split and print that table.                                                                                          |
| `--model <name>`  | Index with another embedding model, for example `jinaai/jina-embeddings-v2-base-code`. The README then shows both models.                                               |
| `--mine`          | Rebuild `bench/tasks` and `bench/memories` from the pinned commits. Not needed to reproduce the results: the task files are committed.                                  |
| `--e2e`           | Print the cost estimate for a run with a real coding agent, with and without remimem. Nothing runs without `--yes`, and that costs money. This path has never been run. |

How a task is built: each one is a real commit that fixes a bug or adds a feature, touches at most eight files, and changes at least one existing source file. The task text is the commit message. The ground truth is the set of non-test source files the commit changed and the symbols whose lines it changed. One task in three (by commit order) is in the test split; settings are tuned on the other two thirds only, and the README reports the test split.

How the baseline works: it takes up to eight keywords from the task text, ranks files by how many of them each contains, and reads whole files in that order until it has read every ground-truth file or used 40,000 tokens.

## Per-phase verification checklist

### Phase 0

Run from a fresh clone:

| Step | Command                        | Correct result                                                          |
| ---- | ------------------------------ | ----------------------------------------------------------------------- |
| 1    | `npm install`                  | Exits 0 and `dist/cli/index.js` exists                                  |
| 2    | `npm run lint`                 | Exits 0 with no findings                                                |
| 3    | `npm run format:check`         | `All matched files use Prettier code style!`                            |
| 4    | `npm run typecheck`            | Exits 0 with no output from `tsc`                                       |
| 5    | `npm run check:chars`          | `check-chars: N tracked files clean`                                    |
| 6    | `npm test`                     | `Test Files  2 passed (2)`                                              |
| 7    | `npx . --version`              | `0.1.0`                                                                 |
| 8    | `npx . doctor`                 | `Node.js <version>: ok`, exit code 0                                    |
| 9    | `git config core.hooksPath`    | `.githooks`                                                             |
| 10   | `git log --format=%B`          | No `Co-authored-by` trailer and no mention of AI authorship             |
| 11   | Open the Actions tab on GitHub | The latest CI run is green on all six jobs (3 systems, 2 Node versions) |

### Phase 1

Run from a fresh clone, after `npm install`:

| Step | Command                                                               | Correct result                                                                                               |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1    | `npm test`                                                            | `Test Files  6 passed (6)`, including `golden output for ts-app`, `py-pkg`, and `go-mod`                     |
| 2    | `npx vitest run test/scanner.test.ts`                                 | 5 tests pass: secrets, binaries, vendored, generated, and oversized files are excluded, with and without git |
| 3    | `npx . doctor`                                                        | Five `Grammar <language>: ok` lines, exit code 0                                                             |
| 4    | `cd test/fixtures/go-mod && npx ../../.. debug chunks store.go`       | Chunks for `Store.Get` (pointer receiver) and `Store.Len` (value receiver) are listed as `method`            |
| 5    | `cd test/fixtures/py-pkg && npx ../../.. debug chunks shop/orders.py` | `validate_order` appears twice (lines 68-142 and 143-164): the oversized function was split                  |
| 6    | `cd test/fixtures/ts-app && npx ../../.. debug chunks db/schema.sql`  | Two `window` chunks, lines 1-60 and 51-82: the line-window fallback with a 10-line overlap                   |
| 7    | `npx . debug chunks ../outside.txt`                                   | `error: Path is outside the repository root: ../outside.txt`, exit code 1                                    |
| 8    | Speed check, see below                                                | A repo of 100k lines or more finishes in under 60 seconds                                                    |

Speed check (needs network access, clones into a temporary folder):

```sh
git clone --depth 1 https://github.com/nestjs/nest.git /tmp/remimem-perf-nest
REMIMEM=$(pwd)
cd /tmp/remimem-perf-nest && node "$REMIMEM/dist/cli/index.js" debug chunks .
```

Expected: one line such as `2796 files, 277244 lines, 11718 symbols, 17008 chunks in 1.68s`. The counts change as that repo changes; the time must be under 60 seconds. Measured on 2026-11-12 on an Apple Silicon laptop: nest (277k lines) 1.7s, prometheus (518k lines) 2.5s, django (1.1M lines) 3.7s.

To regenerate the golden files after an intended parser or chunker change, run `npx vitest run test/golden.test.ts -u` and review the diff of `test/golden/`.

### Phase 2

Run from a fresh clone, after `npm install`:

| Step | Command                                                                   | Correct result                                                                                                                                   |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `npm run coverage`                                                        | `Test Files  7 passed (7)` and no threshold error                                                                                                |
| 2    | The commands in "Index a sample repo and query it"                        | The first `index` reports `Indexed 7 of 7 files`; the second reports `Indexed 0 of 7 files (7 unchanged, 0 removed)`: unchanged files do no work |
| 3    | `search authenticateUser` in the demo copy                                | Result 1 is `function authenticateUser` with `[exact-symbol, keyword]`                                                                           |
| 4    | `search "user auth"` in the demo copy                                     | Result 1 is `function authenticateUser` with `[keyword]`                                                                                         |
| 5    | `node "$REMIMEM/dist/cli/index.js" search x` in a directory with no index | `error: No index found in this directory; run \`remimem index\` first`, exit code 1                                                              |

### Phase 3

Run from a fresh clone, after `npm install`:

| Step | Command                                                                           | Correct result                                                                                                 |
| ---- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1    | `npm run coverage`                                                                | `Test Files  10 passed (10)` and no threshold error                                                            |
| 2    | `npx vitest run test/packer.test.ts`                                              | 7 tests pass, including `property: the output never exceeds the budget` and four `golden:` tests               |
| 3    | `npx vitest run test/hybrid.test.ts`                                              | 4 tests pass: three natural-language queries with no shared keywords find their function                       |
| 4    | `npx . doctor`                                                                    | `SQLite with FTS5 and sqlite-vec: ok` and `Embedding model: local:Xenova/all-MiniLM-L6-v2 ok (384 dimensions)` |
| 5    | The commands in "Index a sample repo and query it"                                | The first `index` reports `Embedded 38 chunks`; the second reports `Embedded 0 chunks`                         |
| 6    | `search "confirm sign-in credentials" -k 3 --budget 150 --debug` in the demo copy | Line 1 is `authenticateUser` with `keyword=- vector=1`; the footer reports at most 150 tokens                  |

To regenerate the packer golden files after an intended change, run `npx vitest run test/packer.test.ts -u` and review the diff of `test/golden/`.

### Phase 4

Run from a fresh clone, after `npm install`:

| Step | Command                                                    | Correct result                                                                                                                           |
| ---- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `npm run coverage`                                         | `Test Files  11 passed (11)` and no threshold error                                                                                      |
| 2    | `npx vitest run test/graph.test.ts`                        | 10 tests pass, including three named `at least 90% of the known call edges resolve` (the expected edges are listed by hand in that file) |
| 3    | `debug symbol authenticateUser --depth 1` in the demo copy | `Calls:` lists `findUser` and `hash`; `Called by:` lists `UserService.login`                                                             |
| 4    | `debug refs findUser` in the demo copy                     | `4 references in 2 files`, as shown in "Inspect the call graph"                                                                          |
| 5    | `search authenticateUser -k 1` in the demo copy            | One full result followed by `(signature only)` blocks tagged `called by authenticateUser` and `calls authenticateUser`                   |

### Phase 5

Run from a fresh clone, after `npm install`:

| Step | Command                                                         | Correct result                                                                                                                                              |
| ---- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `npm run coverage`                                              | `Test Files  12 passed (12)` and no threshold error                                                                                                         |
| 2    | `npx vitest run test/mcp.test.ts`                               | 12 tests pass, including `serve writes nothing but protocol messages to stdout` and `the server lists every tool with a valid schema and short description` |
| 3    | The commands in "Set up a project and get context from the CLI" | `init` reports the config, the `.gitignore` entry, the privacy line, and the index; `context` ends with a footer at or under 300 tokens                     |
| 4    | The raw protocol command in "Confirm the tools appear"          | Two JSON lines; the second lists the six tools                                                                                                              |
| 5    | The MCP Inspector command in the same section                   | The same six tools with valid schemas                                                                                                                       |
| 6    | "Manual run in Claude Code"                                     | `get_context` returns a block for `authenticateUser`                                                                                                        |

### Phase 6

Run from a fresh clone, after `npm install`:

| Step | Command                                                 | Correct result                                                                                                                                                                  |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `npm run coverage`                                      | `Test Files  13 passed (13)` and no threshold error                                                                                                                             |
| 2    | `npx vitest run test/memory.test.ts`                    | 12 tests pass, including `deleting index.db and re-indexing restores memories from memory.json` and `editing a linked function marks its memory stale, and reverting clears it` |
| 3    | The commands in "Project memory"                        | The memory is stored and listed, appears first in `context`, turns `STALE` after the edit, and survives deleting the index                                                      |
| 4    | The MCP Inspector command in "Confirm the tools appear" | All nine tools are listed with valid schemas                                                                                                                                    |

### Phase 7

Run from a fresh clone, after `npm install`:

| Step | Command                                                                              | Correct result                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `npm run coverage`                                                                   | `Test Files  14 passed (14)` and no threshold error                                                                                                                      |
| 2    | `npx vitest run test/incremental.test.ts`                                            | 10 tests pass, including `a tool call re-indexes changed files first, so agents never get stale code` and `watch re-indexes after files change, once the changes settle` |
| 3    | In the demo copy: `context "check a password at login"` twice, then `stats`          | `Queries served: 2`, a tokens-served line, an estimated baseline, and an estimated saving                                                                                |
| 4    | In the demo copy: `watch`, then save a change to `src/hash.ts` from another terminal | A new `Indexed 1 of 8 files` line within about a second                                                                                                                  |
| 5    | Speed check, see below                                                               | A 20-file change re-indexes in under 3 seconds                                                                                                                           |

Speed check on a large repo (needs network access for the clone):

```sh
git clone --depth 1 https://github.com/nestjs/nest.git /tmp/remimem-perf-nest
REMIMEM=$(pwd)
cd /tmp/remimem-perf-nest
node "$REMIMEM/dist/cli/index.js" index
for f in $(git ls-files 'packages/core/**/*.ts' | grep -v spec | head -20); do printf '\nexport function remimemProbe(value: number): number {\n  return value + 1;\n}\n' >> "$f"; done
time node "$REMIMEM/dist/cli/index.js" index
```

Expected: the second `index` prints `Indexed 20 of 2797 files` (the total changes as that repo changes) and `time` reports under 3 seconds. Measured on 2026-11-14 on an Apple M5: 2.0 seconds, of which reading and parsing 0.8s, rebuilding the graph 0.6s, and embedding the new chunks 0.5s. The first `index` of that repo takes about 2 minutes because it embeds every chunk.

### Phase 8

Run from a fresh clone, after `npm install`:

| Step | Command                                                                | Correct result                                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `npm run coverage`                                                     | `Test Files  15 passed (15)` and no threshold error                                                                                                                                                                                     |
| 2    | `npx vitest run test/bench.test.ts`                                    | 9 tests pass, including `the benchmark data in this repo is complete, and the README shows the latest results`                                                                                                                          |
| 3    | `npx . bench --limit 3`                                                | Nine progress lines, then a summary with all tables (three test tasks) and `Partial run: no results file was written.`; about a minute after the clones                                                                                 |
| 4    | `npx . bench`                                                          | The full summary; the headline figures are close to the README's. It writes a new file in `bench/results`: delete it afterwards, or rerun with `--update-readme`, because a test checks that the README matches the newest results file |
| 5    | `npx . bench --compare bench/results/<newest default-model file>.json` | Every line starts with `ok`, exit code 0                                                                                                                                                                                                |
| 6    | `npx . bench --e2e`                                                    | Three lines: the number of agent runs, an estimated cost, and `Nothing was run.`                                                                                                                                                        |

## Troubleshooting

- **`npx .` says "Permission denied" or "command not found".** `dist/` is missing or stale. Run `npm run build`.
- **`npm install` fails with an engine error.** Your Node.js is older than 22.13.0. Install a newer version.
- **A commit is rejected with "em dash or emoji".** The pre-commit hook found a banned character. The message gives the file and line; replace the character and commit again.
- **Windows: `format:check` reports every file.** Line endings were converted to CRLF. Run `git add --renormalize .` and check out the files again.
- **`Grammar for <language> failed to load`.** Run `npx . doctor` to see the underlying error. The usual cause is a missing or truncated file in `grammars/`: run `git status grammars` and `git checkout -- grammars`. Each `.wasm` file there is between 200 KB and 1.5 MB.
- **A golden test fails after you edit a fixture or a query.** That is expected: review the diff, then regenerate with `npx vitest run test/golden.test.ts -u`.
- **`npm install` or `npm ci` fails with `node-gyp rebuild` in `node_modules/better-sqlite3`, often "Could not find any Visual Studio installation" on Windows.** `better-sqlite3` ships ready-made binaries, but on a lockfile install npm still runs node-gyp, which needs to find a C++ toolchain before it decides there is nothing to build. npm 10 carries an older node-gyp that does not recognize recent Visual Studio versions: run `npm install -g npm@11`, delete `node_modules`, and install again. If you have no C++ toolchain at all, run `npm ci --ignore-scripts` and then `npm run prepare`.
- **`npm install` fails while building `better-sqlite3`, or `Could not locate the bindings file`.** No prebuilt SQLite binary matched your platform and Node.js version, so it has to compile. Install Python 3 and a C++ toolchain (Xcode Command Line Tools on macOS, `build-essential` on Debian or Ubuntu, "Desktop development with C++" from Visual Studio Build Tools on Windows), then run `npm rebuild better-sqlite3`.
- **`The index was written by a newer remimem`.** Delete `.remimem/index.db` and run `remimem index` again, or upgrade remimem.
- **Search results look stale or wrong after upgrading remimem.** Run `remimem index --full`.
- **Windows paths.** Paths in the index and in search output always use forward slashes, whatever the platform.
- **`The sqlite-vec extension failed to load`.** The platform package for `sqlite-vec` is missing. Prebuilt extensions exist for macOS (x64, arm64), Linux (x64, arm64), and Windows (x64). Run `npm ls sqlite-vec` and reinstall with `npm install`. Other platforms are not supported yet.
- **`Embedding model ... failed to load`.** The first use downloads the model from huggingface.co. Check the network connection or proxy, then run `npx . doctor`. A partial download can be cleared by deleting `~/.cache/remimem/models`. To work offline or without the model, set `"embedding": { "provider": "none" }` in `.remimem/config.json`; search then uses keywords only.
- **`The index holds vectors from X but the configured model is Y`.** The embedding model in the config changed. Run `remimem index --full` to rebuild the vectors.
- **The MCP client shows remimem as failed or with no tools.** Run the server command from the client configuration in a terminal: it should start and wait silently. If it exits, the message on stderr says why. Check that the command's working directory is the project (or pass `--root`), and that `remimem index` has been run there; tools answer `The index is empty` until it has.
- **`.remimem/memory.json is not valid`.** The file was damaged, usually by a merge conflict. Fix the JSON or restore it with `git checkout -- .remimem/memory.json`. Until then the memories already in the index stay as they are, and nothing is overwritten.
- **A memory is marked STALE.** Code it is linked to changed after it was written. If it is still true, delete it and add it again to link it to the current code; if not, `remimem memory rm <id>`. A memory that arrived through git can also show as stale when your checkout differs from the author's.
- **A tool answers with stale code.** The server re-indexes changed files before each tool call, judging by size and modification time. A file whose content changed while both stayed the same is missed: run `remimem index`, which hashes every file. If answers end with `(index refresh still running ...)`, a large re-index is in progress; ask again shortly.
- **`remimem watch` does not notice changes.** Files under excluded directories (`node_modules`, `dist`, `vendor`, and so on) are not watched. On Linux, a large repo can exceed the inotify watch limit; raise `fs.inotify.max_user_watches`.
- **`remimem bench` says it runs from a source checkout.** The benchmark is not part of the npm package. Clone the repo, run `npm install`, and use `npx . bench`.
- **`remimem bench` fails while cloning or checking out.** Delete the affected directory under `~/.cache/remimem/bench` and run it again; the clone is repeated.
- **Benchmark figures differ from the README.** Small differences between CPU types are expected; use `--compare` to see whether they are within the tolerance. Larger differences usually mean the task files or the pinned commits were changed.
- **A caller or callee is missing from `debug symbol`.** Resolution is best effort and never guesses across an import that leads outside the repo. A call on a value whose type is unknown (`user.save()`) resolves only when one symbol in the repo has that name. Calls to library functions have no edge.
- **Indexing is slow.** Embedding is the slow stage: about 160 chunks per second with the default model on an Apple M5 laptop, so a 277k-line repo takes about 106 seconds. It runs once; later runs embed only changed chunks.
