import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { processFile } from '../indexer/index.js';
import { RemimemError } from '../errors.js';
import { MEMORY_KINDS, MemoryError } from '../memory/index.js';
import { serve } from '../mcp/server.js';
import {
  runContext,
  runDoctor,
  runIndex,
  runInit,
  runMemory,
  runRefs,
  runSearch,
  runStats,
  runWatch,
  runSymbol,
} from './commands.js';
import { resolveInRoot, scan } from '../scanner/index.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

export function buildProgram(): Command {
  const program = new Command('remimem')
    .description('Local-first code context and project memory for coding agents')
    .version(pkg.version);

  program
    .command('doctor')
    .description('Check that this machine can run remimem')
    .action(async () => {
      const { lines, ok } = await runDoctor(process.cwd());
      console.log(lines.join('\n'));
      if (!ok) process.exitCode = 1;
    });

  const tty = process.stderr.isTTY;
  /** A progress bar on stderr while chunks are embedded. Silent when not a terminal. */
  const onEmbedProgress = (done: number, total: number): void => {
    if (!tty) return;
    const filled = Math.round((done / Math.max(total, 1)) * 24);
    process.stderr.write(
      `\rEmbedding [${'#'.repeat(filled)}${'.'.repeat(24 - filled)}] ${done}/${total}`,
    );
  };
  const clearProgress = (): void => {
    if (tty) process.stderr.write('\r\x1b[K');
  };

  program
    .command('init')
    .description('Set up remimem in the current directory and print MCP client configuration')
    .action(async () => {
      const report = await runInit(process.cwd(), { onEmbedProgress });
      clearProgress();
      console.log(report);
    });

  program
    .command('serve')
    .description('Start the MCP server on stdio (this is what MCP clients run)')
    .option('--root <dir>', 'project directory, default the current directory')
    .action(async (options: { root?: string }) => {
      await serve(resolve(options.root ?? process.cwd()));
    });

  program
    .command('context <task>')
    .description('Print the context an agent would get for a task, to paste into any chat')
    .option('--budget <tokens>', 'token budget for the output')
    .action(async (task: string, options: { budget?: string }) => {
      const budget = Number(options.budget);
      console.log(await runContext(process.cwd(), task, Number.isFinite(budget) ? { budget } : {}));
    });

  const memory = program.command('memory').description('Manage project memory by hand');
  const collect = (value: string, all: string[]): string[] => [...all, value];
  memory
    .command('list')
    .description('List memories, or search them with a query')
    .argument('[query]', 'what to look for', '')
    .option('--kind <kind>', 'decision, convention, gotcha, or todo')
    .action(async (query: string, options: { kind?: string }) => {
      console.log(await runMemory(process.cwd(), 'list', { query, kind: options.kind }));
    });
  memory
    .command('add <text>')
    .description('Save a memory')
    .option('--kind <kind>', 'decision, convention, gotcha, or todo', 'decision')
    .option('--path <path>', 'file this is about (repeatable)', collect, [])
    .option('--symbol <name>', 'symbol this is about (repeatable)', collect, [])
    .option('--tag <tag>', 'tag (repeatable)', collect, [])
    .action(
      async (
        text: string,
        options: { kind: string; path: string[]; symbol: string[]; tag: string[] },
      ) => {
        if (!(MEMORY_KINDS as readonly string[]).includes(options.kind)) {
          throw new MemoryError(
            `Unknown kind "${options.kind}". Use one of: ${MEMORY_KINDS.join(', ')}.`,
          );
        }
        console.log(
          await runMemory(process.cwd(), 'add', {
            text,
            kind: options.kind,
            paths: options.path,
            symbols: options.symbol,
            tags: options.tag,
          }),
        );
      },
    );
  memory
    .command('rm <id>')
    .description('Delete a memory')
    .action(async (id: string) => {
      console.log(await runMemory(process.cwd(), 'rm', { id }));
    });

  program
    .command('index')
    .description('Index the current directory, skipping files that have not changed')
    .option('--full', 'reindex every file and rebuild vectors')
    .action(async (options: { full?: boolean }) => {
      const summary = await runIndex(process.cwd(), { ...options, onEmbedProgress });
      clearProgress();
      console.log(summary);
    });

  program
    .command('watch')
    .description('Keep the index fresh while you work')
    .action(async () => {
      const stop = await runWatch(process.cwd(), (line) => console.log(line));
      process.once('SIGINT', () => void stop().then(() => process.exit(0)));
    });

  program
    .command('stats')
    .description('Show queries served and tokens served against an estimated baseline')
    .action(() => {
      console.log(runStats(process.cwd()));
    });

  program
    .command('bench')
    .description('Run the benchmark (from a source checkout of remimem)')
    .option('--mine', 'rebuild the task files from the pinned repositories instead of running')
    .option(
      '--repo <name>',
      'run one repository only (repeatable)',
      (v: string, all: string[]) => [...all, v],
      [],
    )
    .option('--limit <n>', 'run only the first n tasks of each repository')
    .option('--model <name>', 'embedding model to index with')
    .option('--tune', 'also try the tuning configurations on the training split')
    .option('--update-readme', 'paste the summary table into README.md')
    .option('--compare <file>', 'check the run against an earlier results file, within a tolerance')
    .option('--e2e', 'print the cost estimate for the end-to-end agent run (add --yes to run it)')
    .option('--yes', 'with --e2e: actually run it, which costs money')
    .option('--price-per-mtok <usd>', 'with --e2e: price per million input tokens for the estimate')
    .action(
      async (options: {
        mine?: boolean;
        repo: string[];
        limit?: string;
        model?: string;
        tune?: boolean;
        updateReadme?: boolean;
        compare?: string;
        e2e?: boolean;
        yes?: boolean;
        pricePerMtok?: string;
      }) => {
        // Loaded on demand: the benchmark is not part of the published package.
        const { runBenchCommand } = await import('../bench/command.js').catch(() => {
          throw new RemimemError('The benchmark runs from a source checkout of remimem.');
        });
        const ok = await runBenchCommand(options, (line) => console.log(line));
        if (!ok) process.exitCode = 1;
      },
    );

  program
    .command('search <query>')
    .description('Search the index and print the best matching code within a token budget')
    .option('-k, --limit <n>', 'number of results to consider')
    .option('--budget <tokens>', 'token budget for the output')
    .option('--debug', 'print every score before the results')
    .action(
      async (query: string, options: { limit?: string; budget?: string; debug?: boolean }) => {
        const number = (value: string | undefined): number | undefined =>
          value === undefined || !Number.isFinite(Number(value)) ? undefined : Number(value);
        console.log(
          await runSearch(process.cwd(), query, {
            k: number(options.limit),
            budget: number(options.budget),
            debug: options.debug,
          }),
        );
      },
    );

  // Hidden developer commands, not part of the public interface.
  const debug = program.command('debug', { hidden: true });

  debug
    .command('symbol <name>')
    .description('Print a symbol with its callers, callees, and other neighbors')
    .option('--depth <n>', 'hops of callers and callees to show, 0 to 2', '1')
    .option('--signature', 'print the signature instead of the body')
    .action((name: string, options: { depth: string; signature?: boolean }) => {
      console.log(
        runSymbol(process.cwd(), name, {
          depth: Number(options.depth),
          include: options.signature ? 'signature' : 'body',
        }),
      );
    });

  debug
    .command('refs <name>')
    .description('Print every reference to a symbol, grouped by file')
    .action((name: string) => {
      console.log(runRefs(process.cwd(), name));
    });

  debug
    .command('chunks <path>')
    .description('Print the chunks of a file, or scan and chunk a directory and print totals')
    .option('--content', 'print chunk bodies')
    .action(async (path: string, options: { content?: boolean }) => {
      const root = process.cwd();
      const target = resolveInRoot(root, path);
      if (statSync(target).isDirectory()) {
        const started = performance.now();
        const files = scan(target);
        let lines = 0;
        let symbols = 0;
        let chunks = 0;
        for (const file of files) {
          const result = await processFile(target, file.path);
          lines += result.lineCount;
          symbols += result.parsed?.symbols.length ?? 0;
          chunks += result.chunks.length;
        }
        const seconds = ((performance.now() - started) / 1000).toFixed(2);
        console.log(
          `${files.length} files, ${lines} lines, ${symbols} symbols, ${chunks} chunks in ${seconds}s`,
        );
        return;
      }
      const { chunks } = await processFile(root, path);
      for (const chunk of chunks) {
        const label = chunk.symbol ? `${chunk.kind} ${chunk.symbol}` : chunk.kind;
        console.log(`${chunk.path}:${chunk.startLine}-${chunk.endLine}  ${label}`);
        if (chunk.signature) console.log(`  ${chunk.signature.replaceAll('\n', '\n  ')}`);
        if (options.content) console.log(`${chunk.content}\n`);
      }
    });

  return program;
}
