# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, a minor version may contain breaking changes.

## 0.2.0 - 2026-11-19

### Added

- A local dashboard: the code graph one folder at a time (click a file for its symbols with their callers and callees, and click a symbol for its code), a search playground that shows each result's score and reasons and the exact packed answer, a memory manager (add, edit, forget, stale flags), savings per day and per tool, the `doctor` checks, re-indexing, and a validated editor for `.remimem/config.json`. `remimem serve` runs it alongside the MCP tools, and `remimem dashboard` opens it or starts one when no agent is running. It listens on 127.0.0.1 only; every data request needs the random token in the printed address, must be addressed to the dashboard's own host, and changes must be JSON from the dashboard page.
- `dashboard.enabled` (default `true`) and `dashboard.port` (default `0`, any free port) in the configuration.
- `index_status` ends with the dashboard's address when one is running.
- A welcome screen for a bare `remimem`, help grouped by task with examples, a logo for people at a terminal, and an amphora that fills while the embedding model downloads. Piped output stays plain and `NO_COLOR` is honored.

### Changed

- `remimem` with no command prints the welcome screen and exits with code 0 instead of 1.
- `remimem serve` opens a local port for the dashboard unless `dashboard.enabled` is `false`.

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
