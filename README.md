# remimem

remimem: codebase memory for coding agents.

It is a local-first MCP server and CLI that indexes a codebase and gives coding agents (Claude Code, Cursor, VS Code Copilot, any MCP client) the smallest set of code that answers their question, within a token budget. It also keeps project memory, decisions and conventions that persist across sessions, and ships the benchmark below so the savings can be checked.

## Benchmark

How much context does remimem save, and does it find the right code? Each task is a real commit from an open-source repository, described by its commit message. The code is indexed as it was just before that commit, and a strategy is scored on whether it returns the files and symbols the commit went on to change. The baseline imitates an agent that greps for keywords and reads whole files.

<!-- prettier-ignore-start -->
<!-- bench:start -->

Measured on 2026-11-15 with remimem `9e63d69` on Apple M5 (10 cores, 16 GB, darwin 27.2.0, Node.js v24.20.0), embedding model `local:Xenova/all-MiniLM-L6-v2`. Test split: 36 of 108 tasks, held out from tuning. Ground-truth files are the non-test source files a task's commit changed. Token counts are approximate.

**Headline (test split, 36 tasks, `get_context@4000` against the grep baseline).** Tokens: remimem serves 3,827 per call on average; the baseline reads 27,529 per task on average, with each task where it did not read every ground-truth file counted at its 40,000-token cap. That is 86% fewer (target: at least 40% fewer). Charging remimem the same cap for each task where its answer lacks a ground-truth file gives 6,854, 75% fewer. Recall@10: on average 0.93 of a task's ground-truth files are among the ten best-ranked files (baseline 0.79; target 0.80). File recall in the answer: 93% (baseline 60%); counting a file only when a full body from it is shown, not a signature-only block: 92%.

**The same without httpx `cabd1c095e`** (35 tasks), a test task that was inspected while the harness was being debugged, before tuning: Tokens: remimem serves 3,823 per call on average; the baseline reads 27,535 per task on average, with each task where it did not read every ground-truth file counted at its 40,000-token cap. That is 86% fewer (target: at least 40% fewer). Charging remimem the same cap for each task where its answer lacks a ground-truth file gives 6,937, 75% fewer. Recall@10: on average 0.93 of a task's ground-truth files are among the ten best-ranked files (baseline 0.79; target 0.80). File recall in the answer: 93% (baseline 59%); counting a file only when a full body from it is shown, not a signature-only block: 92%.

| Strategy | Tokens per task | File recall | File recall, full body only | Symbol recall | Recall@10 | MRR | Reached | Tokens to first hit | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline: grep and read whole files, 40,000-token cap | 27,529 | 60% | 60% | 57% | 0.79 | 0.40 | 61% | 16,374 | 5 / 9 ms |
| `search_code` at 2,000 tokens | 1,895 | 83% | 80% | 73% | 0.85 | 0.60 | 86% | 534 | 14 / 28 ms |
| `search_code` at 4,000 tokens | 3,353 | 85% | 85% | 74% | 0.85 | 0.60 | 89% | 1,126 | 18 / 30 ms |
| `search_code` at 8,000 tokens | 3,913 | 85% | 85% | 77% | 0.85 | 0.60 | 89% | 953 | 20 / 30 ms |
| `get_context` at 2,000 tokens | 1,943 | 87% | 81% | 67% | 0.93 | 0.61 | 89% | 630 | 15 / 28 ms |
| `get_context` at 4,000 tokens | 3,827 | 93% | 92% | 74% | 0.93 | 0.61 | 94% | 1,228 | 20 / 30 ms |
| `get_context` at 8,000 tokens | 6,218 | 93% | 93% | 78% | 0.93 | 0.61 | 94% | 1,232 | 27 / 43 ms |

Columns: *tokens per task* is the mean size of the answer; for the baseline it is what it read, with a task counted at the 40,000-token cap when it did not read every ground-truth file. *File recall* and *symbol recall* are the share of ground-truth files and symbols present in what was returned (for the baseline, in the files it read); *full body only* does not count a file that appears only as a signature. *Recall@10* is the share of a task's ground-truth files among the ten best-ranked files, averaged over tasks, and *MRR* the mean reciprocal rank of the first one. *Reached* is the share of tasks in which any ground-truth file was returned, and *tokens to first hit* the median over those tasks.

Ablations of `get_context` at 4,000 tokens (test split):

| Strategy | Tokens per task | File recall | File recall, full body only | Symbol recall | Recall@10 | MRR | Reached | Tokens to first hit | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full | 3,827 | 93% | 92% | 74% | 0.93 | 0.61 | 94% | 1,228 | 20 / 30 ms |
| keyword only | 3,824 | 80% | 77% | 68% | 0.88 | 0.54 | 81% | 1,022 | 16 / 23 ms |
| vector only | 3,690 | 79% | 76% | 50% | 0.85 | 0.53 | 83% | 800 | 18 / 29 ms |
| no graph expansion | 3,594 | 92% | 92% | 67% | 0.93 | 0.62 | 94% | 1,212 | 18 / 30 ms |
| no signature compression | 3,896 | 90% | 90% | 67% | 0.93 | 0.61 | 92% | 1,228 | 22 / 32 ms |
| no name-match edges | 3,794 | 93% | 92% | 71% | 0.93 | 0.61 | 94% | 1,228 | 19 / 30 ms |
| with memories | 3,829 | 93% | 90% | 74% | 0.93 | 0.61 | 94% | 1,272 | 26 / 42 ms |

Memory ablation: each repo gets 60 memories made from older commit subjects, unlinked, so they have to match the task text. With memories on, 2.4 are attached per task; 25% of attached memories come from a commit that touched a ground-truth file, and 54% of the tasks that have such a memory get at least one.

Per repository (test split):

| Repository | Language | Lines | Tasks | Baseline tokens per task | `get_context` tokens per task | Baseline recall@10 | `get_context` recall@10 | Baseline file recall | `get_context` file recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [hono](https://github.com/honojs/hono) at `f6fbaf0299` (MIT) | typescript | 99,158 | 12 | 27,622 | 3,866 | 0.67 | 1.00 | 58% | 100% |
| [httpx](https://github.com/encode/httpx) at `b5addb64f0` (BSD-3-Clause) | python | 33,460 | 12 | 28,072 | 3,773 | 0.71 | 0.83 | 71% | 83% |
| [echo](https://github.com/labstack/echo) at `f275a6b110` (MIT) | go | 49,731 | 12 | 26,892 | 3,842 | 1.00 | 0.96 | 50% | 96% |

Worst misses of `get_context@4000` on the test split (3 shown):

- httpx `609df7ecc0`: "Reintroduce `URLTypes`. (#3288)" wanted `httpx/__version__.py`, `httpx/_types.py`; file recall 0%, first ground-truth file ranked nowhere.
- httpx `9fd6f0ca66`: "Ensure JSON representation is compact. #3363 (#3367)" wanted `httpx/_content.py`; file recall 0%, first ground-truth file ranked nowhere.
- echo `8d1ae9d336`: "fix(static): reject encoded path separators that bypass route-level middleware (#3009)" wanted `echo.go`, `middleware/static.go`; file recall 50%, first ground-truth file ranked 1.

Embedding models compared (`get_context@4000`, test split):

| Model | Tokens per task | File recall | File recall, full body only | Symbol recall | Recall@10 | MRR | Latency p50 / p95 | First full index of all repos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `local:Xenova/all-MiniLM-L6-v2` | 3,827 | 93% | 92% | 74% | 0.93 | 0.61 | 20 / 30 ms | 62s |
| `local:jinaai/jina-embeddings-v2-base-code` | 3,769 | 92% | 92% | 74% | 0.93 | 0.65 | 35 / 83 ms | 324s |

Re-indexing after a 20-file change on hono: 0.57s.

Reproduce with `npm install && npx . bench` from a clone. Results vary slightly between CPU types, because the quantized embedding model rounds differently; `npx . bench --compare <results file>` reruns and checks each headline figure against a tolerance.

<!-- bench:end -->
<!-- prettier-ignore-end -->

What these numbers do not show: the tasks are commit messages, which are written after the change and can name the place that was changed, so they are easier than a bug report written beforehand. The test split is 36 tasks, so one task moves a percentage by about three points. The baseline is a simulation, not a real agent. One test-split task was looked at while the harness was being debugged, before any tuning; the settings it prompted were then chosen on the training split alone, and the headline is given with and without it. The method is described in [SETUP.md](SETUP.md#run-the-benchmark).

## Install

In the project you want to index (Node.js 22.13 or newer):

```sh
npx -y remimem init
```

This creates `.remimem/`, builds the index, and prints the client configuration below. The first run downloads a 23 MB embedding model; after that nothing needs the network. To build from source instead, see [SETUP.md](SETUP.md).

## Connect your agent

**Claude Code.** Run this in the project:

```sh
claude mcp add remimem -- npx -y remimem serve
```

or create `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "remimem": { "command": "npx", "args": ["-y", "remimem", "serve"] }
  }
}
```

**Cursor.** Create `.cursor/mcp.json` in the project root with the same content.

**VS Code (Copilot).** Create `.mcp.json` in the workspace root:

```json
{
  "mcpServers": {
    "remimem": { "type": "stdio", "command": "npx", "args": ["-y", "remimem", "serve"] }
  }
}
```

Older VS Code versions read `.vscode/mcp.json` instead, which uses a `servers` key:

```json
{
  "servers": {
    "remimem": { "type": "stdio", "command": "npx", "args": ["-y", "remimem", "serve"] }
  }
}
```

The server works on the directory it is started in; add `"--root", "<path>"` to the args to point it elsewhere.

## How it works

- **Index by structure.** Files are parsed with tree-sitter (TypeScript, JavaScript, Python, Go) into functions, methods, classes, and types; every other text file is indexed in line windows.
- **Search three ways.** A query runs against a keyword index that understands identifiers, a vector index built by a local embedding model, and an exact lookup of symbol names. The rankings are fused.
- **Follow the call graph.** Callers, callees, base classes, and referenced types of the top results are added as signatures, each with the reason it is there.
- **Pack to a budget.** Results are fitted into the token budget you give, grouped by file in line order with `path:start-end` headers. The answer never exceeds the budget and says what was dropped.
- **Remember.** Decisions, conventions, and gotchas are stored with links to code, shown at the top of later answers, and flagged when the code they are about changes.

```text
files -> scanner -> parser -> chunker -> SQLite (keyword index, vectors, call graph, memory)
                                              |
agent -> MCP tool -> retriever (keyword + vector + graph) -> packer -> text within the budget
```

Changed files are re-indexed before each tool call, so answers follow your edits.

## Tools

| Tool               | What it returns                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_context`      | The best starting context for a task: project memory, the top code in full, and neighbor signatures. Inputs: `task`, `budget_tokens` (default 4,000), `paths`. |
| `search_code`      | Ranked code for a query, with the reason each result matched. Inputs: `query`, `k` (default 10), `budget_tokens`, `language`, `paths`.                         |
| `get_symbol`       | One function, class, or type with its callers and callees. Inputs: `name`, `include` (`body` or `signature`), `depth` (0 to 2).                                |
| `get_file_outline` | The symbols of a file with signatures and line numbers, no bodies. Input: `path`.                                                                              |
| `find_references`  | Where a symbol is called, extended, used as a type, or imported, as `path:line` grouped by file. Input: `name`.                                                |
| `remember`         | Saves a decision, convention, gotcha, or todo, optionally linked to files and symbols. Inputs: `text`, `kind`, `paths`, `symbols`, `tags`.                     |
| `recall`           | Matching memories, stale ones marked. Inputs: `query`, `kind`.                                                                                                 |
| `forget`           | Deletes a memory. Input: `id`.                                                                                                                                 |
| `index_status`     | Files, chunks, last indexed commit, pending changes, embedding model.                                                                                          |

There is also one resource, `remimem://overview`: a directory map with the most-referenced symbols per directory.

The same functions are available from the command line: `remimem init`, `index [--full]`, `watch`, `serve`, `search "<query>"`, `context "<task>"`, `memory list|add|rm`, `stats`, `doctor`, and `bench` (from a source checkout).

## Configuration

Optional, in `.remimem/config.json`. Every setting has a default; unknown keys are rejected.

| Setting                                                                 | Default                                         | Meaning                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `include`, `exclude`                                                    | none                                            | Globs that limit which files are indexed. Vendored, generated, binary, oversized, and secret-looking files are always skipped.                                               |
| `maxFileSizeKb`                                                         | 512                                             | Larger files are skipped.                                                                                                                                                    |
| `embedding.provider`                                                    | `local`                                         | `local`, `none` (keyword search only), or `openai` and `voyage`, which send code to that service. Keys come from `OPENAI_API_KEY` or `VOYAGE_API_KEY`, never from this file. |
| `embedding.model`                                                       | `Xenova/all-MiniLM-L6-v2`                       | Changing it needs `remimem index --full`.                                                                                                                                    |
| `retrieval.defaultBudgetTokens`                                         | 4000                                            | Budget when a call does not give one.                                                                                                                                        |
| `retrieval.rrfK`, `keywordLimit`, `vectorLimit`, `keywordWeights`       | 60, 50, 50, content 1 / symbol 5 / path 2       | Ranking fusion.                                                                                                                                                              |
| `retrieval.textFileWeight`                                              | 0.25                                            | How much a result from a file that is not parsed as code counts against one from code.                                                                                       |
| `retrieval.graphTopN`, `graphMaxNeighbors`, `edgeWeights`               | 10, 20, exact 0.5 / import 0.4 / name-match 0.2 | Call graph expansion.                                                                                                                                                        |
| `retrieval.memoryLimit`, `memoryMinKeywordMatch`, `memoryMinSimilarity` | 5, 0.5, 0.4                                     | Which memories `get_context` attaches.                                                                                                                                       |
| `watch.debounceMs`                                                      | 500                                             | How long `remimem watch` waits after the last change.                                                                                                                        |

Memories are mirrored to `.remimem/memory.json`, which is meant to be committed so a team shares them. The index, `.remimem/index.db`, is local and is added to `.gitignore` by `init`.

## Privacy

Everything runs on your machine. Code is parsed, embedded, and stored locally, in one SQLite file inside the project. Nothing is sent anywhere unless you set `embedding.provider` to `openai` or `voyage`, in which case the text of indexed code goes to that service to be embedded. There is no telemetry. The query log behind `remimem stats` stays in the local index. The one network request in the default setup is the first download of the embedding model from huggingface.co.

## Limitations

- **The benchmark tasks are commit messages.** They are written after the change and often name what changed, so they are easier than bug reports. The test split is 36 tasks from three repositories, and the baseline is a simulation of a grep-driven agent, not a real one.
- **Documentation is down-weighted.** Results from files that are not parsed as code (Markdown, JSON, SQL) count a quarter by default, because changelogs were crowding out code. If you search mostly for prose, raise `retrieval.textFileWeight`.
- **No type inference.** The call graph resolves names, not types: `user.save()` is linked only when one symbol in the repo is named `save`. In a hand-check on a large TypeScript repo about one in four of these name-match links was wrong. Calls into libraries have no links at all.
- **Structural parsing covers four languages.** TypeScript, JavaScript, Python, and Go. Everything else is searchable as text in line windows, without symbols or a call graph.
- **The OpenAI and Voyage embedding providers are tested only against stubs.** They have never been run against the live services.
- **Install size.** The local embedding runtime brings about 430 MB into `node_modules`, and a first `npx` run downloads and unpacks about 750 MB.
- **The end-to-end benchmark hook has never been run.** `remimem bench --e2e` prints a cost estimate and does nothing more without `--yes`; the agent flags it would use are unverified.
- **Memories cost a little code.** With project memory attached, the share of right files shown with a full body dropped by about 2 points in the benchmark (90% against 92%), because memory takes up to a quarter of the budget. Only a quarter of the memories attached there were relevant.
- **The default embedding model is not trained on code.** A code-trained alternative found no more of the right files in the benchmark and indexed five times slower, so it is an option, not the default.
- **Change detection trusts size and modification time.** A change that keeps both is missed until `remimem index` runs, which hashes every file.
- **Platform gaps.** Vector search has no prebuilt extension for Windows on ARM. TypeScript path aliases from `tsconfig.json` are not read. Go struct embedding and implicit interface satisfaction produce no graph links.

## Roadmap

- More languages at structural depth: Java, Rust, C#.
- Team mode: a shared index and memory with access control.
- A pull request reviewer that uses project memory and conventions to flag violations.
- Smarter context: reranking with a small cross-encoder, and learning from which results agents open.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), which includes how to add a language. [SETUP.md](SETUP.md) covers building, testing, and verifying each part, [DECISIONS.md](DECISIONS.md) records why things are the way they are, and [CHANGELOG.md](CHANGELOG.md) lists what changed.

## License

[MIT](LICENSE)
