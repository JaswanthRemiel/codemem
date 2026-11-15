Measured on 2026-11-15 with remimem `ad143d3` on Apple M5 (10 cores, 16 GB, darwin 27.2.0, Node.js v24.20.0), embedding model `local:jinaai/jina-embeddings-v2-base-code`. Test split: 36 of 108 tasks, held out from tuning. Ground-truth files are the non-test source files a task's commit changed. Token counts are approximate.

**Headline (test split, 36 tasks, `get_context@4000` against the grep baseline).** Tokens: remimem serves 3,769 per call on average; the baseline reads 27,529 per task on average, with each task where it did not read every ground-truth file counted at its 40,000-token cap. That is 86% fewer (target: at least 40% fewer). Charging remimem the same cap for each task where its answer lacks a ground-truth file gives 7,780, 72% fewer. Recall@10: on average 0.93 of a task's ground-truth files are among the ten best-ranked files (baseline 0.79; target 0.80). File recall in the answer: 92% (baseline 60%); counting a file only when a full body from it is shown, not a signature-only block: 92%.

**The same without httpx `cabd1c095e`** (35 tasks), a test task that was inspected while the harness was being debugged, before tuning: Tokens: remimem serves 3,791 per call on average; the baseline reads 27,535 per task on average, with each task where it did not read every ground-truth file counted at its 40,000-token cap. That is 86% fewer (target: at least 40% fewer). Charging remimem the same cap for each task where its answer lacks a ground-truth file gives 7,917, 71% fewer. Recall@10: on average 0.93 of a task's ground-truth files are among the ten best-ranked files (baseline 0.79; target 0.80). File recall in the answer: 92% (baseline 59%); counting a file only when a full body from it is shown, not a signature-only block: 92%.

| Strategy | Tokens per task | File recall | File recall, full body only | Symbol recall | Recall@10 | MRR | Reached | Tokens to first hit | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline: grep and read whole files, 40,000-token cap | 27,529 | 60% | 60% | 57% | 0.79 | 0.40 | 61% | 16,374 | 5 / 12 ms |
| `search_code` at 2,000 tokens | 1,911 | 84% | 72% | 67% | 0.92 | 0.65 | 86% | 351 | 30 / 80 ms |
| `search_code` at 4,000 tokens | 3,344 | 90% | 84% | 73% | 0.92 | 0.65 | 92% | 403 | 32 / 84 ms |
| `search_code` at 8,000 tokens | 3,847 | 92% | 84% | 74% | 0.92 | 0.65 | 94% | 453 | 34 / 79 ms |
| `get_context` at 2,000 tokens | 1,941 | 81% | 72% | 64% | 0.93 | 0.65 | 83% | 308 | 27 / 77 ms |
| `get_context` at 4,000 tokens | 3,769 | 92% | 92% | 74% | 0.93 | 0.65 | 94% | 453 | 35 / 83 ms |
| `get_context` at 8,000 tokens | 6,059 | 93% | 93% | 78% | 0.93 | 0.65 | 94% | 453 | 40 / 93 ms |

Columns: *tokens per task* is the mean size of the answer; for the baseline it is what it read, with a task counted at the 40,000-token cap when it did not read every ground-truth file. *File recall* and *symbol recall* are the share of ground-truth files and symbols present in what was returned (for the baseline, in the files it read); *full body only* does not count a file that appears only as a signature. *Recall@10* is the share of a task's ground-truth files among the ten best-ranked files, averaged over tasks, and *MRR* the mean reciprocal rank of the first one. *Reached* is the share of tasks in which any ground-truth file was returned, and *tokens to first hit* the median over those tasks.

Ablations of `get_context` at 4,000 tokens (test split):

| Strategy | Tokens per task | File recall | File recall, full body only | Symbol recall | Recall@10 | MRR | Reached | Tokens to first hit | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full | 3,769 | 92% | 92% | 74% | 0.93 | 0.65 | 94% | 453 | 35 / 83 ms |
| keyword only | 3,824 | 80% | 77% | 68% | 0.88 | 0.54 | 81% | 1,022 | 17 / 25 ms |
| vector only | 3,603 | 88% | 85% | 62% | 0.86 | 0.58 | 92% | 1,118 | 28 / 72 ms |
| no graph expansion | 3,576 | 90% | 90% | 71% | 0.93 | 0.66 | 92% | 363 | 30 / 79 ms |
| no signature compression | 3,873 | 87% | 87% | 71% | 0.93 | 0.65 | 89% | 453 | 32 / 88 ms |
| no name-match edges | 3,765 | 92% | 92% | 74% | 0.93 | 0.66 | 94% | 453 | 30 / 83 ms |
| with memories | 3,790 | 92% | 92% | 74% | 0.93 | 0.65 | 94% | 583 | 47 / 137 ms |

Memory ablation: each repo gets 60 memories made from older commit subjects, unlinked, so they have to match the task text. With memories on, 3.6 are attached per task; 20% of attached memories come from a commit that touched a ground-truth file, and 67% of the tasks that have such a memory get at least one.

Per repository (test split):

| Repository | Language | Lines | Tasks | Baseline tokens per task | `get_context` tokens per task | Baseline recall@10 | `get_context` recall@10 | Baseline file recall | `get_context` file recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [hono](https://github.com/honojs/hono) at `f6fbaf0299` (MIT) | typescript | 99,158 | 12 | 27,622 | 3,855 | 0.67 | 0.92 | 58% | 90% |
| [httpx](https://github.com/encode/httpx) at `b5addb64f0` (BSD-3-Clause) | python | 33,460 | 12 | 28,072 | 3,547 | 0.71 | 0.96 | 71% | 96% |
| [echo](https://github.com/labstack/echo) at `f275a6b110` (MIT) | go | 49,731 | 12 | 26,892 | 3,907 | 1.00 | 0.92 | 50% | 92% |

Worst misses of `get_context@4000` on the test split (4 shown):

- hono `28e7498e88`: "fix(timing): escape double quotes and backslashes in Server-Timing descriptions (#5478)" wanted `src/middleware/timing/timing.ts`; file recall 0%, first ground-truth file ranked nowhere.
- echo `48128ab391`: "fix(static): preserve matched handler 404s" wanted `middleware/static.go`; file recall 0%, first ground-truth file ranked 12.
- httpx `609df7ecc0`: "Reintroduce `URLTypes`. (#3288)" wanted `httpx/__version__.py`, `httpx/_types.py`; file recall 50%, first ground-truth file ranked 1.
- hono `ed1d5f7213`: "fix(auth): escape backslashes in the WWW-Authenticate realm (#5590)" wanted `src/middleware/basic-auth/index.ts`, `src/middleware/bearer-auth/index.ts`, `src/middleware/jwk/jwk.ts`, `src/middleware/jwt/jwt.ts`; file recall 75%, first ground-truth file ranked 2.

Re-indexing after a 20-file change on hono: 0.98s.

Reproduce with `npm install && npx . bench` from a clone. Results vary slightly between CPU types, because the quantized embedding model rounds differently; `npx . bench --compare <results file>` reruns and checks each headline figure against a tolerance.
