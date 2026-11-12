# Setup

How to set up, run, and test codemem from a fresh machine. This file is updated at the end of every phase. Sections for features that do not exist yet say which phase adds them.

## Prerequisites

| Tool    | Version                               | Check            |
| ------- | ------------------------------------- | ---------------- |
| Node.js | 22.13.0 or newer (CI tests 22 and 24) | `node --version` |
| npm     | 10 or newer (ships with Node.js)      | `npm --version`  |
| Git     | 2.30 or newer                         | `git --version`  |

No compiler or other build tools are needed.

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
```

Expected: every command exits with code 0. `npm run check:chars` prints `check-chars: N tracked files clean`. `npm test` ends with `Test Files  2 passed (2)`.

## Run the CLI

```sh
npx . --version
npx . doctor
```

Expected output:

```text
0.1.0
Node.js 22.x.x: ok
Not checked yet (added in later phases): grammars, SQLite extensions, embedding model, index health
```

The Node.js version line shows your own version.

## Index a sample repo and query it

Not available yet. `codemem index` and `codemem search` arrive in Phase 2, `codemem context` in Phase 5, and `codemem stats` in Phase 7.

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

## Troubleshooting

- **`npx .` says "Permission denied" or "command not found".** `dist/` is missing or stale. Run `npm run build`.
- **`npm install` fails with an engine error.** Your Node.js is older than 22.13.0. Install a newer version.
- **A commit is rejected with "em dash or emoji".** The pre-commit hook found a banned character. The message gives the file and line; replace the character and commit again.
- **Windows: `format:check` reports every file.** Line endings were converted to CRLF. Run `git add --renormalize .` and check out the files again.
- **Grammar loading, SQLite extension loading, embedding model download.** These parts do not exist yet; their troubleshooting notes are added in Phases 1 to 3.
