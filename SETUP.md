# Setup

How to set up, run, and test codemem from a fresh machine. This file is updated at the end of every phase. Sections for features that do not exist yet say which phase adds them.

## Prerequisites

| Tool    | Version                                                                                    | Check            |
| ------- | ------------------------------------------------------------------------------------------ | ---------------- |
| Node.js | 22.13.0 or newer (CI tests 22 and 24)                                                      | `node --version` |
| npm     | 11 or newer for working on this repo. Node.js 22 ships npm 10: run `npm install -g npm@11` | `npm --version`  |
| Git     | 2.30 or newer                                                                              | `git --version`  |

Normally no compiler or other build tools are needed: the tree-sitter grammars ship in the repo as WebAssembly files under `grammars/`, and `better-sqlite3` downloads a prebuilt binary for common platforms. If no prebuilt binary exists for your platform, `npm install` compiles it and needs Python 3 and a C++ toolchain (see Troubleshooting).

The npm 11 requirement applies only to a checkout of this repo. The packaged tarball installs and runs with the npm 10 that ships with Node.js 22; CI checks that on every push.

The first `codemem index`, `codemem doctor`, or `npm test` downloads the default embedding model (about 23 MB) from huggingface.co into `~/.cache/codemem/models`. Set `CODEMEM_CACHE_DIR` to keep it elsewhere. After that no network access is needed.

OS notes:

- macOS and Linux: nothing extra.
- Windows: use PowerShell, cmd, or Git Bash. The repo forces LF line endings through `.gitattributes`, so no Git line-ending setting is needed.

## Install and build

```sh
git clone https://github.com/JaswanthRemiel/codemem.git
cd codemem
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

Expected: every command exits with code 0. `npm run check:chars` prints `check-chars: N tracked files clean`. `npm test` builds first, then ends with `Test Files  13 passed (13)`. `npm run coverage` runs the same tests, prints a coverage table, and fails if line coverage of `src/parser`, `src/chunker`, `src/retriever`, `src/packer`, `src/graph`, or `src/memory` drops below 80%.

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
Not checked yet (added in a later phase): index health
```

The Node.js line shows your own version. A failed check prints `failed (...)` with a fix hint, and `doctor` exits with code 1.

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

Work on a copy of a fixture so the index does not land inside this repo. Run these from the codemem checkout:

```sh
CODEMEM=$(pwd)
rm -rf /tmp/codemem-demo && cp -R test/fixtures/ts-app /tmp/codemem-demo
cd /tmp/codemem-demo
node "$CODEMEM/dist/cli/index.js" index
node "$CODEMEM/dist/cli/index.js" index
node "$CODEMEM/dist/cli/index.js" search authenticateUser -k 1
node "$CODEMEM/dist/cli/index.js" search "confirm sign-in credentials" -k 3 --budget 150 --debug
```

On Windows PowerShell, replace the first three lines with:

```powershell
$CODEMEM = (Get-Location).Path
Copy-Item -Recurse -Force test/fixtures/ts-app $env:TEMP/codemem-demo
Set-Location $env:TEMP/codemem-demo
```

and use `node "$CODEMEM/dist/cli/index.js"` the same way.

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

The index is a single file, `.codemem/index.db`, in the directory you indexed. `index --full` reindexes every file and is how you switch embedding models. Token counts are approximate.

Optional settings go in `.codemem/config.json`. Every field has a default; this example shows a few:

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
- `embedding.model`: for a slower, code-trained local model use `jinaai/jina-embeddings-v2-base-code` (163 MB download), then run `codemem index --full`.
- `retrieval`: also `keywordWeights`, `defaultK`, and the graph settings `graphTopN` (how many top results get neighbors, 0 turns expansion off), `graphMaxNeighbors`, and `edgeWeights`.

## Inspect the call graph

Two hidden developer commands print what the MCP tools `get_symbol` and `find_references` return. Run them in the demo copy from the previous section:

```sh
node "$CODEMEM/dist/cli/index.js" debug symbol authenticateUser --depth 2
node "$CODEMEM/dist/cli/index.js" debug refs findUser
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

`codemem stats` arrives in Phase 7.

## Set up a project and get context from the CLI

`codemem init` does the whole setup for a project: it creates `.codemem/config.json`, adds the index to `.gitignore`, builds the index, and prints the client configuration shown in the next section. Run from the codemem checkout:

```sh
CODEMEM=$(pwd)
rm -rf /tmp/codemem-demo && cp -R test/fixtures/ts-app /tmp/codemem-demo
cd /tmp/codemem-demo
node "$CODEMEM/dist/cli/index.js" init
node "$CODEMEM/dist/cli/index.js" context "check a password at login" --budget 300
```

Expected: `init` starts with these lines and then prints the client configurations:

```text
Created .codemem/config.json (empty: every setting has a default).
Added .codemem/index.db* to .gitignore.
Privacy: everything runs on this machine. No code leaves it and there is no telemetry.
Indexed 8 of 8 files (0 unchanged, 0 removed) in 0.53s. Embedded 39 chunks (0 from cache) with local:Xenova/all-MiniLM-L6-v2. Index: 8 files, 32 symbols, 39 chunks.
```

(8 files rather than 7 because the new `.gitignore` is indexed too.) `context` prints what the `get_context` tool returns, so it can be pasted into any chat. Its first line is a block header such as `--- src/service.ts:33-38 method UserService.login [keyword, vector, ...]` and its last line is a footer such as `~265 tokens | 3 results | 24 dropped for budget`, never above the budget.

## Connect to Claude Code, Cursor, and VS Code

Clients start the server with `codemem serve`, which speaks MCP on stdin and stdout. It serves the directory it is started in, or the one given with `--root <dir>`. `codemem init` prints these configurations with the right command filled in. From a source checkout the command is `node <checkout>/dist/cli/index.js serve`; once the package is installed from npm it is `npx -y codemem serve`.

**Claude Code.** In the project directory run:

```sh
claude mcp add codemem -- node "$CODEMEM/dist/cli/index.js" serve
```

or create `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "codemem": { "command": "node", "args": ["/path/to/codemem/dist/cli/index.js", "serve"] }
  }
}
```

**Cursor.** Create `.cursor/mcp.json` in the project root with the same content.

**VS Code (Copilot).** Create `.mcp.json` in the workspace root with the same content plus `"type": "stdio"` in the server entry. VS Code versions that predate that file read `.vscode/mcp.json`, which uses a top-level `"servers"` key instead of `"mcpServers"`; `codemem init` prints both.

### Confirm the tools appear

Without any client, list the tools over the raw protocol (run in `/tmp/codemem-demo` after `init`):

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node "$CODEMEM/dist/cli/index.js" serve
```

Expected: two lines of JSON. The second lists nine tools: `get_context`, `search_code`, `get_symbol`, `get_file_outline`, `find_references`, `remember`, `recall`, `forget`, `index_status`.

With the MCP Inspector (downloads the inspector package on first use):

```sh
npx @modelcontextprotocol/inspector --cli node "$CODEMEM/dist/cli/index.js" serve --method tools/list
```

Expected: JSON with the same nine tools, each with an `inputSchema` of type `object`. Run `npx @modelcontextprotocol/inspector node "$CODEMEM/dist/cli/index.js" serve` instead to open the Inspector's web page and call tools by hand.

### Manual run in Claude Code

1. Run the `init` commands from "Set up a project and get context from the CLI".
2. In `/tmp/codemem-demo`, run `claude mcp add codemem -- node "$CODEMEM/dist/cli/index.js" serve`.
3. Start `claude` in that directory and enter `/mcp`. Expected: `codemem` is listed as connected with 9 tools.
4. Ask: `Call the codemem get_context tool with the task "check a password at login" and show me the raw result.`
5. Approve the tool call when asked. Expected: the tool result contains a block headed `--- src/auth.ts:10-23 function authenticateUser [...]` and ends with a `~N tokens | N results` footer.
6. Clean up with `claude mcp remove codemem`.

In Cursor the tools appear under Settings, MCP; in VS Code under Chat: Open Customizations, MCP Servers.

Logs go to stderr, never stdout. Set `CODEMEM_LOG_LEVEL` to `error`, `warn` (default), `info`, or `debug`.

## Project memory

Memories are short notes about the codebase (kinds: `decision`, `convention`, `gotcha`, `todo`) that agents save with the `remember` tool and see again at the top of `get_context` results. They can be linked to files and symbols. The same operations are available by hand. Run in `/tmp/codemem-demo` after `init`:

```sh
node "$CODEMEM/dist/cli/index.js" memory add "Passwords are hashed with the fixture salt; never store them in plain text." --kind decision --symbol hash --tag security
node "$CODEMEM/dist/cli/index.js" memory list
node "$CODEMEM/dist/cli/index.js" context "hash a password" --budget 400
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

Memories are mirrored to `.codemem/memory.json`, sorted by id with one memory per line so that git merges stay clean. Commit that file to share them with a team; `.codemem/index.db` stays local. The file is the source of truth: a changed file (after `git pull`, or a hand edit) is loaded on the next command.

A memory is marked stale when code it is linked to changes. Edit the linked function, re-index, and list again:

```sh
sed -i.bak 's/total \* 31/total * 37/' src/hash.ts
node "$CODEMEM/dist/cli/index.js" index
node "$CODEMEM/dist/cli/index.js" memory list
```

Expected: the first line of the list is now `[decision] m_20283783 STALE: linked code has changed since this was written`.

Deleting the index does not lose memories:

```sh
rm .codemem/index.db*
node "$CODEMEM/dist/cli/index.js" index
node "$CODEMEM/dist/cli/index.js" memory list
```

Expected: the same memory is listed again. A memory linked to a whole file (`--path`) is shown whenever that file is in the results. One linked to a symbol is shown when that symbol is in the results. Otherwise it must match the task: at least half of the task's terms, or enough similarity in meaning (`retrieval.memoryMinKeywordMatch` and `retrieval.memoryMinSimilarity` in the config).

Other commands: `memory list "<query>"` searches, `memory list --kind todo` filters, `memory rm <id>` deletes, and `memory add` takes `--path <file>` as well as `--symbol` (both repeatable).

## Run the benchmark

Not available yet. The benchmark arrives in Phase 8.

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
git clone --depth 1 https://github.com/nestjs/nest.git /tmp/codemem-perf-nest
CODEMEM=$(pwd)
cd /tmp/codemem-perf-nest && node "$CODEMEM/dist/cli/index.js" debug chunks .
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
| 5    | `node "$CODEMEM/dist/cli/index.js" search x` in a directory with no index | `error: No index found in this directory; run \`codemem index\` first`, exit code 1                                                              |

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

## Troubleshooting

- **`npx .` says "Permission denied" or "command not found".** `dist/` is missing or stale. Run `npm run build`.
- **`npm install` fails with an engine error.** Your Node.js is older than 22.13.0. Install a newer version.
- **A commit is rejected with "em dash or emoji".** The pre-commit hook found a banned character. The message gives the file and line; replace the character and commit again.
- **Windows: `format:check` reports every file.** Line endings were converted to CRLF. Run `git add --renormalize .` and check out the files again.
- **`Grammar for <language> failed to load`.** Run `npx . doctor` to see the underlying error. The usual cause is a missing or truncated file in `grammars/`: run `git status grammars` and `git checkout -- grammars`. Each `.wasm` file there is between 200 KB and 1.5 MB.
- **A golden test fails after you edit a fixture or a query.** That is expected: review the diff, then regenerate with `npx vitest run test/golden.test.ts -u`.
- **`npm install` or `npm ci` fails with `node-gyp rebuild` in `node_modules/better-sqlite3`, often "Could not find any Visual Studio installation" on Windows.** `better-sqlite3` ships ready-made binaries, but on a lockfile install npm still runs node-gyp, which needs to find a C++ toolchain before it decides there is nothing to build. npm 10 carries an older node-gyp that does not recognize recent Visual Studio versions: run `npm install -g npm@11`, delete `node_modules`, and install again. If you have no C++ toolchain at all, run `npm ci --ignore-scripts` and then `npm run prepare`.
- **`npm install` fails while building `better-sqlite3`, or `Could not locate the bindings file`.** No prebuilt SQLite binary matched your platform and Node.js version, so it has to compile. Install Python 3 and a C++ toolchain (Xcode Command Line Tools on macOS, `build-essential` on Debian or Ubuntu, "Desktop development with C++" from Visual Studio Build Tools on Windows), then run `npm rebuild better-sqlite3`.
- **`The index was written by a newer codemem`.** Delete `.codemem/index.db` and run `codemem index` again, or upgrade codemem.
- **Search results look stale or wrong after upgrading codemem.** Run `codemem index --full`.
- **Windows paths.** Paths in the index and in search output always use forward slashes, whatever the platform.
- **`The sqlite-vec extension failed to load`.** The platform package for `sqlite-vec` is missing. Prebuilt extensions exist for macOS (x64, arm64), Linux (x64, arm64), and Windows (x64). Run `npm ls sqlite-vec` and reinstall with `npm install`. Other platforms are not supported yet.
- **`Embedding model ... failed to load`.** The first use downloads the model from huggingface.co. Check the network connection or proxy, then run `npx . doctor`. A partial download can be cleared by deleting `~/.cache/codemem/models`. To work offline or without the model, set `"embedding": { "provider": "none" }` in `.codemem/config.json`; search then uses keywords only.
- **`The index holds vectors from X but the configured model is Y`.** The embedding model in the config changed. Run `codemem index --full` to rebuild the vectors.
- **The MCP client shows codemem as failed or with no tools.** Run the server command from the client configuration in a terminal: it should start and wait silently. If it exits, the message on stderr says why. Check that the command's working directory is the project (or pass `--root`), and that `codemem index` has been run there; tools answer `The index is empty` until it has.
- **`.codemem/memory.json is not valid`.** The file was damaged, usually by a merge conflict. Fix the JSON or restore it with `git checkout -- .codemem/memory.json`. Until then the memories already in the index stay as they are, and nothing is overwritten.
- **A memory is marked STALE.** Code it is linked to changed after it was written. If it is still true, delete it and add it again to link it to the current code; if not, `codemem memory rm <id>`. A memory that arrived through git can also show as stale when your checkout differs from the author's.
- **A tool answers with stale code.** The server does not re-index on its own yet (that arrives in Phase 7). Run `codemem index` after changing files; `index_status` shows how many files are pending.
- **A caller or callee is missing from `debug symbol`.** Resolution is best effort and never guesses across an import that leads outside the repo. A call on a value whose type is unknown (`user.save()`) resolves only when one symbol in the repo has that name. Calls to library functions have no edge.
- **Indexing is slow.** Embedding is the slow stage: about 160 chunks per second with the default model on an Apple M5 laptop, so a 277k-line repo takes about 106 seconds. It runs once; later runs embed only changed chunks.
