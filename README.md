# codemem

codemem is a local-first MCP server and CLI that indexes a codebase and gives coding agents only the code context they need.

It is under active development and not ready for use yet.

To build and test it from source, see [SETUP.md](SETUP.md).

## Benchmark

How much context does codemem save, and does it find the right code? Each task is a real commit from an open-source repository, described by its commit message; the code is indexed as it was just before that commit, and a strategy is scored on whether it returns the files and symbols the commit went on to change. The baseline imitates an agent that greps for keywords and reads whole files.

<!-- prettier-ignore-start -->
<!-- bench:start -->

Measured on 2026-11-15 with codemem `9e63d69` on Apple M5 (10 cores, 16 GB, darwin 27.2.0, Node.js v24.20.0), embedding model `local:Xenova/all-MiniLM-L6-v2`. Test split: 36 of 108 tasks, held out from tuning. Ground-truth files are the non-test source files a task's commit changed. Token counts are approximate.

**Headline (test split, 36 tasks, `get_context@4000` against the grep baseline).** Tokens: codemem serves 3,827 per call on average; the baseline reads 27,529 per task on average, with each task where it did not read every ground-truth file counted at its 40,000-token cap. That is 86% fewer (target: at least 40% fewer). Charging codemem the same cap for each task where its answer lacks a ground-truth file gives 6,854, 75% fewer. Recall@10: on average 0.93 of a task's ground-truth files are among the ten best-ranked files (baseline 0.79; target 0.80). File recall in the answer: 93% (baseline 60%); counting a file only when a full body from it is shown, not a signature-only block: 92%.

**The same without httpx `cabd1c095e`** (35 tasks), a test task that was inspected while the harness was being debugged, before tuning: Tokens: codemem serves 3,823 per call on average; the baseline reads 27,535 per task on average, with each task where it did not read every ground-truth file counted at its 40,000-token cap. That is 86% fewer (target: at least 40% fewer). Charging codemem the same cap for each task where its answer lacks a ground-truth file gives 6,937, 75% fewer. Recall@10: on average 0.93 of a task's ground-truth files are among the ten best-ranked files (baseline 0.79; target 0.80). File recall in the answer: 93% (baseline 59%); counting a file only when a full body from it is shown, not a signature-only block: 92%.

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

What these numbers do not show: the tasks are commit messages, which are written after the change and can name the place that was changed, so they are easier than a bug report written beforehand. The test split is 36 tasks, so one task moves a percentage by about three points. The baseline is a simulation, not a real agent. One test-split task was looked at while the harness was being debugged, before any tuning; the settings it prompted were then chosen on the training split alone. Details and the full method are in [SETUP.md](SETUP.md).
