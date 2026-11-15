Measured on 2026-11-15 with codemem `952f39e-dirty` on Apple M5 (10 cores, 16 GB, darwin 27.2.0, Node.js v24.20.0), embedding model `local:jinaai/jina-embeddings-v2-base-code`. Test split: 36 of 108 tasks, held out from tuning. Token counts are approximate.

**Headline (test split, `get_context@4000` against the grep baseline):** the right file is in the answer for 92% of ground-truth files (baseline 60%), a ground-truth file is among the ten best-ranked files in 94% of tasks (baseline 81%), and on the 22 tasks where both reached a ground-truth file, the median tokens to get there are 363 against 16,374 (98% fewer).

| Strategy | File recall | Symbol recall | Hit@10 | MRR | Reached | Tokens to first hit | Tokens used | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline: grep and read whole files, 40,000-token cap | 60% | 57% | 81% | 0.40 | 61% | 16,374 | 27,678 | 5 / 11 ms |
| `search_code` at 2,000 tokens | 84% | 67% | 94% | 0.65 | 86% | 351 | 1,911 | 27 / 83 ms |
| `search_code` at 4,000 tokens | 90% | 73% | 94% | 0.65 | 92% | 403 | 3,344 | 33 / 88 ms |
| `search_code` at 8,000 tokens | 92% | 74% | 94% | 0.65 | 94% | 453 | 3,847 | 33 / 86 ms |
| `get_context` at 2,000 tokens | 81% | 64% | 94% | 0.65 | 83% | 308 | 1,941 | 27 / 84 ms |
| `get_context` at 4,000 tokens | 92% | 74% | 94% | 0.65 | 94% | 453 | 3,769 | 33 / 91 ms |
| `get_context` at 8,000 tokens | 93% | 78% | 94% | 0.65 | 94% | 453 | 6,059 | 40 / 96 ms |

Columns: *file recall* and *symbol recall* are the share of ground-truth files and symbols present in what was returned (for the baseline, in the files it read). *Hit@10* is the share of tasks with a ground-truth file among the ten best-ranked files, and *MRR* the mean reciprocal rank of the first one. *Reached* is the share of tasks in which a ground-truth file was returned at all; *tokens to first hit* is the median over those tasks. *Tokens used* is the mean size of the answer (for the baseline, of everything it read).

Ablations of `get_context` at 4,000 tokens (test split):

| Strategy | File recall | Symbol recall | Hit@10 | MRR | Reached | Tokens to first hit | Tokens used | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full | 92% | 74% | 94% | 0.65 | 94% | 453 | 3,769 | 33 / 91 ms |
| keyword only | 80% | 68% | 89% | 0.54 | 81% | 1,022 | 3,824 | 17 / 27 ms |
| vector only | 88% | 62% | 89% | 0.58 | 92% | 1,118 | 3,603 | 27 / 74 ms |
| no graph expansion | 90% | 71% | 94% | 0.66 | 92% | 363 | 3,576 | 29 / 85 ms |
| no signature compression | 87% | 71% | 94% | 0.65 | 89% | 453 | 3,873 | 32 / 91 ms |
| no name-match edges | 92% | 74% | 94% | 0.66 | 94% | 453 | 3,765 | 30 / 88 ms |
| with memories | 92% | 74% | 94% | 0.65 | 94% | 583 | 3,790 | 44 / 147 ms |

Memory ablation: each repo gets 60 memories made from older commit subjects, unlinked, so they have to match the task text. With memories on, 3.6 are attached per task; 20% of attached memories come from a commit that touched a ground-truth file, and 67% of the tasks that have such a memory get at least one.

Per repository (test split):

| Repository | Language | Lines | Tasks | Baseline file recall | `get_context` file recall | Baseline tokens to first hit | `get_context` tokens to first hit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [hono](https://github.com/honojs/hono) at `f6fbaf0299` (MIT) | typescript | 99,158 | 12 | 58% | 90% | 14,067 | 132 |
| [httpx](https://github.com/encode/httpx) at `b5addb64f0` (BSD-3-Clause) | python | 33,460 | 12 | 71% | 96% | 23,928 | 453 |
| [echo](https://github.com/labstack/echo) at `f275a6b110` (MIT) | go | 49,731 | 12 | 50% | 92% | 9,890 | 1,445 |

Worst misses of `get_context@4000` on the test split (4 shown):

- hono `28e7498e88`: "fix(timing): escape double quotes and backslashes in Server-Timing descriptions (#5478)" wanted `src/middleware/timing/timing.ts`; file recall 0%, first ground-truth file ranked nowhere.
- echo `48128ab391`: "fix(static): preserve matched handler 404s" wanted `middleware/static.go`; file recall 0%, first ground-truth file ranked 12.
- httpx `609df7ecc0`: "Reintroduce `URLTypes`. (#3288)" wanted `httpx/__version__.py`, `httpx/_types.py`; file recall 50%, first ground-truth file ranked 1.
- hono `ed1d5f7213`: "fix(auth): escape backslashes in the WWW-Authenticate realm (#5590)" wanted `src/middleware/basic-auth/index.ts`, `src/middleware/bearer-auth/index.ts`, `src/middleware/jwk/jwk.ts`, `src/middleware/jwt/jwt.ts`; file recall 75%, first ground-truth file ranked 2.

Re-indexing after a 20-file change on hono: 0.97s.

Reproduce with `npm install && npx . bench` from a clone. Results vary slightly between CPU types, because the quantized embedding model rounds differently; `npx . bench --compare <results file>` reruns and checks each headline figure against a tolerance.
