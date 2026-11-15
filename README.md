# codemem

codemem is a local-first MCP server and CLI that indexes a codebase and gives coding agents only the code context they need.

It is under active development and not ready for use yet.

To build and test it from source, see [SETUP.md](SETUP.md).

## Benchmark

How much context does codemem save, and does it find the right code? Each task is a real commit from an open-source repository, described by its commit message; the code is indexed as it was just before that commit, and a strategy is scored on whether it returns the files and symbols the commit went on to change. The baseline imitates an agent that greps for keywords and reads whole files.

<!-- prettier-ignore-start -->
<!-- bench:start -->

Measured on 2026-11-15 with codemem `952f39e` on Apple M5 (10 cores, 16 GB, darwin 27.2.0, Node.js v24.20.0), embedding model `local:Xenova/all-MiniLM-L6-v2`. Test split: 36 of 108 tasks, held out from tuning. Token counts are approximate.

**Headline (test split, `get_context@4000` against the grep baseline):** the right file is in the answer for 93% of ground-truth files (baseline 60%), a ground-truth file is among the ten best-ranked files in 94% of tasks (baseline 81%), and on the 22 tasks where both reached a ground-truth file, the median tokens to get there are 719 against 16,374 (96% fewer).

| Strategy | File recall | Symbol recall | Hit@10 | MRR | Reached | Tokens to first hit | Tokens used | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline: grep and read whole files, 40,000-token cap | 60% | 57% | 81% | 0.40 | 61% | 16,374 | 27,678 | 5 / 10 ms |
| `search_code` at 2,000 tokens | 83% | 73% | 89% | 0.60 | 86% | 534 | 1,895 | 14 / 30 ms |
| `search_code` at 4,000 tokens | 85% | 74% | 89% | 0.60 | 89% | 1,126 | 3,353 | 19 / 32 ms |
| `search_code` at 8,000 tokens | 85% | 77% | 89% | 0.60 | 89% | 953 | 3,913 | 22 / 30 ms |
| `get_context` at 2,000 tokens | 87% | 67% | 94% | 0.61 | 89% | 630 | 1,943 | 16 / 33 ms |
| `get_context` at 4,000 tokens | 93% | 74% | 94% | 0.61 | 94% | 1,228 | 3,827 | 22 / 35 ms |
| `get_context` at 8,000 tokens | 93% | 78% | 94% | 0.61 | 94% | 1,232 | 6,218 | 29 / 42 ms |

Columns: *file recall* and *symbol recall* are the share of ground-truth files and symbols present in what was returned (for the baseline, in the files it read). *Hit@10* is the share of tasks with a ground-truth file among the ten best-ranked files, and *MRR* the mean reciprocal rank of the first one. *Reached* is the share of tasks in which a ground-truth file was returned at all; *tokens to first hit* is the median over those tasks. *Tokens used* is the mean size of the answer (for the baseline, of everything it read).

Ablations of `get_context` at 4,000 tokens (test split):

| Strategy | File recall | Symbol recall | Hit@10 | MRR | Reached | Tokens to first hit | Tokens used | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full | 93% | 74% | 94% | 0.61 | 94% | 1,228 | 3,827 | 22 / 35 ms |
| keyword only | 80% | 68% | 89% | 0.54 | 81% | 1,022 | 3,824 | 16 / 23 ms |
| vector only | 79% | 50% | 89% | 0.53 | 83% | 800 | 3,690 | 19 / 27 ms |
| no graph expansion | 92% | 67% | 94% | 0.62 | 94% | 1,212 | 3,594 | 19 / 33 ms |
| no signature compression | 90% | 67% | 94% | 0.61 | 92% | 1,228 | 3,896 | 22 / 36 ms |
| no name-match edges | 93% | 71% | 94% | 0.61 | 94% | 1,228 | 3,794 | 20 / 35 ms |
| with memories | 93% | 74% | 94% | 0.61 | 94% | 1,272 | 3,829 | 27 / 49 ms |

Memory ablation: each repo gets 60 memories made from older commit subjects, unlinked, so they have to match the task text. With memories on, 2.4 are attached per task; 25% of attached memories come from a commit that touched a ground-truth file, and 54% of the tasks that have such a memory get at least one.

Per repository (test split):

| Repository | Language | Lines | Tasks | Baseline file recall | `get_context` file recall | Baseline tokens to first hit | `get_context` tokens to first hit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [hono](https://github.com/honojs/hono) at `f6fbaf0299` (MIT) | typescript | 99,158 | 12 | 58% | 100% | 14,067 | 1,718 |
| [httpx](https://github.com/encode/httpx) at `b5addb64f0` (BSD-3-Clause) | python | 33,460 | 12 | 71% | 83% | 23,928 | 719 |
| [echo](https://github.com/labstack/echo) at `f275a6b110` (MIT) | go | 49,731 | 12 | 50% | 96% | 9,890 | 1,232 |

Worst misses of `get_context@4000` on the test split (3 shown):

- httpx `609df7ecc0`: "Reintroduce `URLTypes`. (#3288)" wanted `httpx/__version__.py`, `httpx/_types.py`; file recall 0%, first ground-truth file ranked nowhere.
- httpx `9fd6f0ca66`: "Ensure JSON representation is compact. #3363 (#3367)" wanted `httpx/_content.py`; file recall 0%, first ground-truth file ranked nowhere.
- echo `8d1ae9d336`: "fix(static): reject encoded path separators that bypass route-level middleware (#3009)" wanted `echo.go`, `middleware/static.go`; file recall 50%, first ground-truth file ranked 1.

Embedding models compared (`get_context@4000`, test split):

| Model | File recall | Symbol recall | Hit@10 | MRR | Latency p50 / p95 | First full index of all repos |
| --- | --- | --- | --- | --- | --- | --- |
| `local:Xenova/all-MiniLM-L6-v2` | 93% | 74% | 94% | 0.61 | 22 / 35 ms | 63s |
| `local:jinaai/jina-embeddings-v2-base-code` | 92% | 74% | 94% | 0.65 | 33 / 91 ms | 346s |

Re-indexing after a 20-file change on hono: 0.57s.

Reproduce with `npm install && npx . bench` from a clone. Results vary slightly between CPU types, because the quantized embedding model rounds differently; `npx . bench --compare <results file>` reruns and checks each headline figure against a tolerance.

<!-- bench:end -->
<!-- prettier-ignore-end -->

What these numbers do not show: the tasks are commit messages, which are written after the change and can name the place that was changed, so they are easier than a bug report written beforehand. The test split is 36 tasks, so one task moves a percentage by about three points. The baseline is a simulation, not a real agent. One test-split task was looked at while the harness was being debugged, before any tuning; the settings it prompted were then chosen on the training split alone. Details and the full method are in [SETUP.md](SETUP.md).
