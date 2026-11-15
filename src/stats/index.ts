import type { Store } from '../store/index.js';

const number = (n: number): string => n.toLocaleString('en-US');

/**
 * `remimem stats`: what the tools served, against an estimated baseline. The baseline of a
 * query is the size of every whole file that a full result came from, which is what an agent
 * reading files would have loaded to see the same code. Files that only contributed a
 * signature are not counted. Tools that do not return code
 * (references, memory, status) count the same on both sides, so they claim no saving.
 */
export function formatStats(store: Store): string {
  const rows = store.queryLogSummary();
  if (rows.length === 0) {
    return 'No queries logged yet. Queries are logged when an MCP client or `remimem context` uses the index.';
  }
  const total = (pick: (row: (typeof rows)[number]) => number): number =>
    rows.reduce((sum, row) => sum + pick(row), 0);
  const queries = total((r) => r.queries);
  const served = total((r) => r.tokensReturned);
  const baseline = total((r) => r.baselineTokens);
  const saved = baseline - served;
  const since = rows.map((r) => r.since).sort()[0] ?? '';
  const width = Math.max(...rows.map((r) => r.tool.length));
  return [
    `Queries served: ${number(queries)} since ${since.slice(0, 10)}`,
    `Tokens served: ~${number(served)}`,
    `Estimated baseline: ~${number(baseline)} tokens (reading in full every file a result body came from)`,
    `Estimated saving: up to ~${number(saved)} tokens (${baseline > 0 ? Math.round((saved / baseline) * 100) : 0}%)`,
    '',
    'By tool (queries, tokens served, estimated baseline, mean latency):',
    ...rows.map(
      (r) =>
        `  ${r.tool.padEnd(width)}  ${number(r.queries)}  ~${number(r.tokensReturned)}  ~${number(r.baselineTokens)}  ${r.meanLatencyMs} ms`,
    ),
    '',
    'Token counts are approximate, and the baseline is an estimate, not a measurement: it assumes an agent would have read each of those files in full, so treat the saving as an upper bound. `remimem bench` measures savings against a simulated grep-and-read agent.',
  ].join('\n');
}
