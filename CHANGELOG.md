# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, a minor version may contain breaking changes.

## 0.1.0 - 2026-11-15

First version.

### Added

- Indexing: a scanner that respects `.gitignore` and skips vendored, generated, binary, oversized, and secret-looking files; tree-sitter parsing for TypeScript, TSX, JavaScript, Python, and Go; one chunk per function, method, type, and class header; line windows for every other text file.
- Storage in one SQLite file per project, with an identifier-aware keyword index, vectors in `sqlite-vec`, and numbered migrations.
- Embeddings from a local model by default (`Xenova/all-MiniLM-L6-v2`), with optional OpenAI and Voyage providers and a cache so unchanged text is not embedded twice.
- Hybrid retrieval: keyword and vector rankings fused by reciprocal rank, exact symbol names first, a reason on every result.
- A call graph with a confidence on every link (`exact`, `import`, `name-match`), used to add the neighbors of the top results as signatures.
- A packer that fits results into a token budget, grouped by file in line order, and never exceeds it.
- Project memory: decisions, conventions, gotchas, and todos, linked to code, mirrored to `.remimem/memory.json`, and marked stale when the linked code changes.
- An MCP server over stdio with nine tools (`get_context`, `search_code`, `get_symbol`, `get_file_outline`, `find_references`, `remember`, `recall`, `forget`, `index_status`) and the `remimem://overview` resource. Changed files are re-indexed before each tool call.
- A CLI: `init`, `index`, `watch`, `serve`, `search`, `context`, `memory`, `stats`, `doctor`, and `bench`.
- A reproducible benchmark on three open-source repositories with a grep-and-read baseline, ablations, and a held-out test split.

### Notes

- The project was developed under the working name codemem and renamed before release, because that name was taken on npm.
