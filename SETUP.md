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

Expected: every command exits with code 0. `npm run check:chars` prints `check-chars: N tracked files clean`. `npm test` ends with `Test Files  7 passed (7)`. `npm run coverage` runs the same tests, prints a coverage table, and fails if line coverage of `src/parser`, `src/chunker`, or `src/retriever` drops below 80%.

## Run the CLI

```sh
npx . --version
npx . doctor
```

Expected output:

```text
0.1.0
Node.js 22.x.x: ok
Grammar javascript: ok
Grammar typescript: ok
Grammar tsx: ok
Grammar python: ok
Grammar go: ok
Not checked yet (added in later phases): SQLite extensions, embedding model, index health
```

The Node.js version line shows your own version.

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
node "$CODEMEM/dist/cli/index.js" search authenticateUser -k 3
node "$CODEMEM/dist/cli/index.js" search "user auth" -k 3
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
Indexed 7 of 7 files (0 unchanged, 0 removed) in 0.28s. Index: 7 files, 32 symbols, 38 chunks.
Indexed 0 of 7 files (7 unchanged, 0 removed) in 0.01s. Index: 7 files, 32 symbols, 38 chunks.
1. src/auth.ts:10-23  function authenticateUser  [exact-symbol, keyword]
   export async function authenticateUser(id: string, password: string): Promise<boolean>
2. src/service.ts:1-2  window  [keyword]
   import { authenticateUser, parseToken } from './auth';
3. src/service.ts:33-38  method UserService.login  [keyword]
   @Log('login') async login(id: string, password: string): Promise<boolean>
1. src/auth.ts:10-23  function authenticateUser  [keyword]
   export async function authenticateUser(id: string, password: string): Promise<boolean>
2. src/service.ts:1-2  window  [keyword]
   import { authenticateUser, parseToken } from './auth';
3. src/auth.ts:5-8  interface Claims  [keyword]
   export interface Claims
```

The index is a single file, `.codemem/index.db`, in the directory you indexed. `index --full` reindexes every file. `search --debug` adds scores. Search is keyword-only until Phase 3 adds embeddings, and `--budget` arrives with the packer in the same phase.

Optional settings go in `.codemem/config.json`; every field has a default:

```json
{ "include": ["src/**"], "exclude": ["**/*.test.ts"], "maxFileSizeKb": 512 }
```

`codemem context` arrives in Phase 5 and `codemem stats` in Phase 7.

## Connect to Claude Code, Cursor, and VS Code

Not available yet. The MCP server arrives in Phase 5.

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
- **SQLite extension loading (`sqlite-vec`), embedding model download.** These parts do not exist yet; their troubleshooting notes are added in Phase 3.
