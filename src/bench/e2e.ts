// Optional end-to-end run: a real coding agent gets the same tasks twice, with and without
// remimem attached over MCP. It needs the Claude Code CLI and a paid account, so it runs only
// with an explicit flag, and prints an estimated cost before doing anything.
//
// This file has never been run by the project's build: no API spend was authorized. Treat
// the `claude` flags and the JSON fields read below as unverified until someone runs it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchDir, ensureClone, readRepos } from './index.js';
import type { BenchTask } from './mine.js';

/** Rough input tokens one agent run uses on a task of this size; an assumption, not a measurement. */
const ASSUMED_TOKENS_PER_RUN = 200_000;

export interface E2eOptions {
  /** Tasks per repository, from the test split. */
  tasks: number;
  /** Price per million input tokens, in US dollars, for the estimate. */
  pricePerMillion: number;
  /** Without this the command only prints the estimate. */
  yes: boolean;
}

interface AgentRun {
  inputTokens: number;
  /** Share of the ground-truth files the agent edited. */
  editedRecall: number;
}

function runAgent(dir: string, task: BenchTask, mcpConfig: string | null): AgentRun {
  // shortcut: files an earlier run created stay in the clone untracked; they do not count
  // as edits. Remove them between runs if they turn out to influence the agent.
  execFileSync('git', ['checkout', '--quiet', '--force', '--detach', task.parent], { cwd: dir });
  const prompt = `${task.text}\n\nMake this change in the code.`;
  const args = ['-p', prompt, '--output-format', 'json', '--max-turns', '25'];
  if (mcpConfig) args.push('--mcp-config', mcpConfig);
  const output = execFileSync('claude', args, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
  const usage = (JSON.parse(output) as { usage?: Record<string, number> }).usage ?? {};
  const inputTokens =
    (usage['input_tokens'] ?? 0) +
    (usage['cache_read_input_tokens'] ?? 0) +
    (usage['cache_creation_input_tokens'] ?? 0);
  const edited = new Set(
    execFileSync('git', ['diff', '--name-only'], { cwd: dir, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean),
  );
  return {
    inputTokens,
    editedRecall: task.files.filter((path) => edited.has(path)).length / task.files.length,
  };
}

/** `remimem bench --e2e`. Prints the estimate; runs only when `yes` is set. */
export function runE2e(options: E2eOptions, print: (line: string) => void): void {
  const repos = readRepos();
  const runs = repos.length * options.tasks * 2;
  const millions = (runs * ASSUMED_TOKENS_PER_RUN) / 1e6;
  print(
    `End-to-end run: ${options.tasks} test tasks in each of ${repos.length} repositories, each with and without remimem: ${runs} agent runs.`,
  );
  print(
    `Estimated cost: about ${millions.toFixed(1)} million input tokens (assuming ${ASSUMED_TOKENS_PER_RUN.toLocaleString('en-US')} per run), about $${(millions * options.pricePerMillion).toFixed(0)} at $${options.pricePerMillion} per million. Both figures are assumptions; check your model's price.`,
  );
  if (!options.yes) {
    print(
      'Nothing was run. Add --yes to start. This uses your Claude Code account and costs money.',
    );
    return;
  }
  const cli = fileURLToPath(new URL('../cli/index.js', import.meta.url));
  const mcpConfig = join(tmpdir(), 'remimem-bench-mcp.json');
  const rows: string[] = [];
  for (const repo of repos) {
    const dir = ensureClone(repo, print);
    writeFileSync(
      mcpConfig,
      JSON.stringify({
        mcpServers: { remimem: { command: 'node', args: [cli, 'serve', '--root', dir] } },
      }),
    );
    const tasks = readFileSync(join(benchDir(), 'tasks', `${repo.name}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BenchTask)
      .filter((task) => task.split === 'test')
      .slice(0, options.tasks);
    for (const task of tasks) {
      const plain = runAgent(dir, task, null);
      const assisted = runAgent(dir, task, mcpConfig);
      const line = `${repo.name} ${task.id}: without remimem ${plain.inputTokens} input tokens, edited ${Math.round(plain.editedRecall * 100)}% of the right files; with remimem ${assisted.inputTokens}, ${Math.round(assisted.editedRecall * 100)}%`;
      rows.push(line);
      print(line);
    }
    execFileSync('git', ['checkout', '--quiet', '--force', repo.commit], { cwd: dir });
  }
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(join(benchDir(), 'results', `e2e-${date}.txt`), `${rows.join('\n')}\n`);
}
