# Grammars

Prebuilt tree-sitter grammars (`.wasm`) and the symbol queries codemem runs on them (`.scm`).

| File              | Source                                                                          | Version |
| ----------------- | ------------------------------------------------------------------------------- | ------- |
| `typescript.wasm` | [tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript) | v0.23.2 |
| `tsx.wasm`        | [tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript) | v0.23.2 |
| `javascript.wasm` | [tree-sitter-javascript](https://github.com/tree-sitter/tree-sitter-javascript) | v0.25.0 |
| `python.wasm`     | [tree-sitter-python](https://github.com/tree-sitter/tree-sitter-python)         | v0.25.0 |
| `go.wasm`         | [tree-sitter-go](https://github.com/tree-sitter/tree-sitter-go)                 | v0.25.0 |

The `.wasm` files are the unmodified release assets of those projects, which are MIT licensed. To update one, download the `.wasm` asset from the project's GitHub release, replace the file here, update this table, and run `npm test`.

Query files: `ecma.scm` is shared by JavaScript, TypeScript, and TSX; `javascript.scm` and `typescript.scm` add the language-specific patterns; `python.scm` and `go.scm` stand alone. Capture names the parser understands: `@def.<kind>` with `@name` and optional `@body` and `@receiver`; `@call` with `@callee` and optional `@recv`; `@import` with `@source` and `@iname`.
