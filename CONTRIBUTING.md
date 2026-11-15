# Contributing

Thanks for looking. This file covers how to work on remimem and how to add a language. Setup, build, and test instructions with expected output are in [SETUP.md](SETUP.md); the reasons behind the design are in [DECISIONS.md](DECISIONS.md).

## Getting started

```sh
git clone https://github.com/JaswanthRemiel/remimem.git
cd remimem
npm install
npm test
```

You need Node.js 22.13 or newer and npm 11 or newer (see SETUP.md for why npm 11).

## Before you open a pull request

Run the same checks CI runs:

```sh
npm run lint
npm run format:check
npm run typecheck
npm run check:chars
npm run coverage
```

- `npm run coverage` fails if line coverage of `parser`, `chunker`, `retriever`, `packer`, `graph`, or `memory` drops below 80%.
- `npm run check:chars` fails on an em dash or an emoji in any tracked file. Use commas, colons, parentheses, or separate sentences.
- Commit messages follow Conventional Commits, for example `feat(retriever): add RRF fusion`.
- Keep `DECISIONS.md` current when you make a choice someone will later ask about, and `SETUP.md` when a command or its output changes.
- Only `src/store/` may contain SQL. A lint rule enforces the import boundary.
- The MCP server speaks on stdout, so nothing else may write there. Use `log` from `src/log.ts`, which writes to stderr.

If your change affects retrieval, run the benchmark (`npx . bench`) and say in the pull request how the test-split figures moved. Tune settings on the training split only (`npx . bench --tune`).

## How to add a language

Structural support for a language has five parts. Python is the smallest existing example to copy from.

1. **Grammar.** Download the language's `.wasm` file from its tree-sitter grammar release and put it in `grammars/<language>.wasm`. Add a row to the table in `grammars/README.md` with the source and version.
2. **Queries.** Write `grammars/<language>.scm`. The parser understands these capture names:
   - `@def.<kind>` on a definition, with `@name` and optionally `@body`. Kinds: `function`, `method`, `class`, `interface`, `type`, `enum`, `constant`, and `overload` for a signature that precedes its implementation. A method declared outside its type (as in Go) also captures `@receiver`.
   - `@call` with `@callee` and optionally `@recv` for the receiver expression.
   - `@ref.extends`, `@ref.implements`, and `@ref.type` on the name being referred to.
   - `@import` on the statement, with `@source` for the module and one of `@iname` (a named binding, optionally with `@ialias`), `@idefault`, `@inamespace`, or `@imodule` (a whole-module import).

   Earlier patterns win when two match the same name, so put the specific pattern first. `npx . debug chunks <file>` shows what a file turns into.

3. **Parser tables.** In `src/parser/index.ts` add the language to the `Lang` type, its file extensions to `EXTENSIONS`, and its query file to `QUERY_FILES`.
4. **Module resolution.** In `src/graph/index.ts` add the language to `FAMILY` and teach `findModule` how an import source maps to files in the repo. Without this, calls still resolve within a file and by unique name, but not through imports.
5. **Fixture and tests.** Add a small project under `test/fixtures/` that exercises the language's tricky cases (decorators, nested functions, methods outside their type, overloads, whatever applies), with at least one call across files. Then:
   - add it to `test/golden.test.ts` and generate the golden file with `npx vitest run test/golden.test.ts -u`, and read the result line by line;
   - add hand-written assertions to `test/parser.test.ts`, as the other languages have;
   - list its call graph by hand in the `CALLS` table of `test/graph.test.ts`. At least 90% of those edges must resolve, and no edge may be invented.

`remimem doctor` checks that every grammar loads, so a new language shows up there once step 3 is done.

## Reporting bugs and asking for features

Use the issue templates. For a retrieval problem, the most useful thing is the query, what you expected to see, and the output of `remimem search "<query>" --debug`, which shows every score.
