import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../config/index.js';
import { createProvider } from '../embedder/index.js';
import { benchDir, mine, runBench, type BenchResults } from './index.js';
import { compareResults, renderSummary, renderTuning, updateReadme } from './report.js';

export interface BenchCommandOptions {
  mine?: boolean;
  repo?: string[];
  limit?: string;
  model?: string;
  tune?: boolean;
  updateReadme?: boolean;
  compare?: string;
  e2e?: boolean;
  yes?: boolean;
  pricePerMtok?: string;
}

/** `codemem bench`. Returns false when a comparison is out of tolerance. */
export async function runBenchCommand(
  options: BenchCommandOptions,
  print: (line: string) => void,
): Promise<boolean> {
  if (options.e2e) {
    const { runE2e } = await import('./e2e.js');
    const price = Number(options.pricePerMtok);
    runE2e(
      {
        tasks: 3,
        pricePerMillion: Number.isFinite(price) && price > 0 ? price : 3,
        yes: options.yes === true,
      },
      print,
    );
    return true;
  }
  if (options.mine) {
    await mine(print);
    return true;
  }
  const limit = Number(options.limit);
  const results = await runBench({
    ...(options.repo?.length ? { repos: options.repo } : {}),
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.tune ? { tune: true } : {}),
    log: print,
  });
  // A partial run is for trying things out: it is printed, not recorded.
  if (options.repo?.length || (Number.isFinite(limit) && limit > 0)) {
    print('');
    print(renderSummary(results));
    print('\nPartial run: no results file was written.');
    return true;
  }
  const model = options.model ? `-${options.model.replace(/[^a-z0-9]+/gi, '-')}` : '';
  const dir = join(benchDir(), 'results');
  const base = join(dir, `${results.date}-${results.gitSha}${model}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(results, null, 1)}\n`);

  // The README shows the default model's latest run, with the latest run of each other
  // model beside it.
  const { main, others } = latestResults(dir);
  const summary = main ? renderSummary(main, others) : renderSummary(results);
  const tuning = renderTuning(results);
  writeFileSync(`${base}.md`, `${renderSummary(results)}\n${tuning ? `\n${tuning}\n` : ''}`);
  print('');
  print(renderSummary(results));
  if (tuning) print(`\n${tuning}`);
  print(`\nRaw results: ${base}.json`);
  if (options.updateReadme) {
    updateReadme(join(benchDir(), '..', 'README.md'), summary);
    print('README.md updated.');
  }
  if (options.compare) {
    const expected = JSON.parse(readFileSync(options.compare, 'utf8')) as BenchResults;
    const { lines, ok } = compareResults(expected, results);
    print(`\nComparison with ${options.compare}:`);
    for (const line of lines) print(line);
    return ok;
  }
  return true;
}

/**
 * The newest results file of the default embedding model, and the newest of each other
 * model. File names start with the date, so name order is time order.
 */
export function latestResults(dir: string): {
  main: BenchResults | undefined;
  others: BenchResults[];
} {
  const defaultModel = createProvider(parseConfig({}).embedding)?.id;
  const newest = new Map<string, BenchResults>();
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const results = JSON.parse(readFileSync(join(dir, name), 'utf8')) as BenchResults;
    newest.set(results.embeddingModel, results);
  }
  const main = defaultModel ? newest.get(defaultModel) : undefined;
  return { main, others: [...newest.values()].filter((r) => r !== main) };
}
