import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { CONFIG_DIR, loadConfig } from '../config/index.js';
import { findDashboard, startDashboard } from '../dashboard/server.js';
import { createProvider } from '../embedder/index.js';
import { processFile } from '../indexer/index.js';
import { Store } from '../store/index.js';
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
import { banner, clearLine, embedProgress, paint } from './ui.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

const HELP_ORDER = [
  'init',
  'search',
  'context',
  'memory',
  'index',
  'watch',
  'dashboard',
  'stats',
  'doctor',
  'serve',
  'bench',
];

/** True when a dashboard answers at `url`; a stale discovery file can outlive its server. */
async function reachable(url: string): Promise<boolean> {
  const { origin, searchParams } = new URL(url);
  try {
    const res = await fetch(`${origin}/api/overview`, {
      headers: { 'x-remimem-token': searchParams.get('token') ?? '' },
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Opens a URL in the default browser; failures are ignored, the URL is printed anyway. */
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true })
      .on('error', () => undefined)
      .unref();
  } catch {
    // No browser available (a server or container): the printed URL is enough.
  }
}

export function buildProgram(): Command {
  const program = new Command('remimem')
    .description(
      'Gives coding agents only the code they need, within a token budget, and remembers your project.',
    )
    .version(pkg.version, '-v, --version', 'print the version')
    .helpOption('-h, --help', 'show help for a command')
    .helpCommand(false)
    .showSuggestionAfterError(true)
    // The logo above help, only when a person is reading it in a terminal.
    .addHelpText('beforeAll', () => (process.stdout.isTTY ? banner(pkg.version) : ''))
    .addHelpText(
      'after',
      () => `
${paint('bold', 'Examples:')}
  ${paint('cyan', 'remimem init')}                                  set up this project, print client configs
  ${paint('cyan', 'remimem search "how are passwords hashed"')}     find code by meaning or by name
  ${paint('cyan', 'remimem context "add rate limiting to login"')}  everything an agent needs for a task
  ${paint('cyan', 'remimem memory add "Money is stored in cents" --kind convention')}

Help for one command: ${paint('cyan', 'remimem <command> --help')}
Docs: https://github.com/JaswanthRemiel/remimem`,
    );

  program
    .command('doctor')
    .helpGroup('Check:')
    .description('Check that everything is installed and working')
    .action(async () => {
      const { lines, ok } = await runDoctor(process.cwd());
      console.log(lines.join('\n'));
      if (!ok) process.exitCode = 1;
    });

  program
    .command('init')
    .helpGroup('Get started:')
    .description('Set up this project: index the code and print the config for your agent')
    .action(async () => {
      const root = process.cwd();
      if (process.stdout.isTTY) {
        console.log(banner(pkg.version));
        console.log(`Setting up remimem in ${paint('bold', root)}\n`);
      }
      const report = await runInit(root, { onEmbedProgress: embedProgress });
      clearLine();
      // The status lines come first, before the blank line that starts the client configs.
      const split = report.indexOf('\n\n');
      const status = split === -1 ? report : report.slice(0, split);
      const rest = split === -1 ? '' : report.slice(split);
      const check = paint('green', '✓');
      console.log(
        process.stdout.isTTY
          ? status
              .split('\n')
              .map((line) => `${check} ${line}`)
              .join('\n') + rest
          : report,
      );
    });

  program
    .command('serve')
    .helpGroup('For MCP clients:')
    .description('Start the MCP server (your agent runs this, not you)')
    .option('--root <dir>', 'project directory, default the current directory')
    .action(async (options: { root?: string }) => {
      await serve(resolve(options.root ?? process.cwd()));
    });

  program
    .command('context <task>')
    .helpGroup('Find code:')
    .description('Everything an agent needs for a task, ready to paste into any chat')
    .option('--budget <tokens>', 'token budget for the output')
    .action(async (task: string, options: { budget?: string }) => {
      const budget = Number(options.budget);
      console.log(await runContext(process.cwd(), task, Number.isFinite(budget) ? { budget } : {}));
    });

  const memory = program
    .command('memory')
    .helpGroup('Project memory:')
    .description('Save, list, and delete decisions and conventions by hand');
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
    .helpGroup('Keep the index fresh:')
    .description('Bring the index up to date (only changed files are re-read)')
    .option('--full', 'reindex every file and rebuild vectors')
    .action(async (options: { full?: boolean }) => {
      const summary = await runIndex(process.cwd(), { ...options, onEmbedProgress: embedProgress });
      clearLine();
      console.log(summary);
    });

  program
    .command('watch')
    .helpGroup('Keep the index fresh:')
    .description('Re-index automatically while you edit')
    .action(async () => {
      const stop = await runWatch(process.cwd(), (line) => console.log(line));
      process.once('SIGINT', () => void stop().then(() => process.exit(0)));
    });

  program
    .command('dashboard')
    .helpGroup('Check:')
    .description('Open the local dashboard: code graph, search, memories, savings, and settings')
    .option(
      '--port <n>',
      'port on 127.0.0.1 when starting a new dashboard (default: any free port)',
    )
    .option('--no-open', 'print the address without opening a browser')
    .action(async (options: { port?: string; open: boolean }) => {
      const root = process.cwd();
      // An agent's `remimem serve` already runs one for this project: use that.
      const running = findDashboard(root);
      if (running && (await reachable(running.url))) {
        console.log(`Dashboard (served by a running remimem server): ${running.url}`);
        if (options.open) openBrowser(running.url);
        return;
      }
      if (!existsSync(join(root, CONFIG_DIR, 'index.db'))) {
        throw new RemimemError('No index here yet. Run `remimem init` in the project first.');
      }
      const config = loadConfig(root);
      const store = new Store(join(root, CONFIG_DIR, 'index.db'));
      const ctx = { root, config, store, provider: createProvider(config.embedding) };
      const port = options.port === undefined ? config.dashboard.port : Number(options.port);
      const dashboard = await startDashboard(ctx, port);
      console.log(`Dashboard: ${paint('cyan', dashboard.url)}\nPress Ctrl+C to stop.`);
      if (options.open) openBrowser(dashboard.url);
      // Ctrl+C, or a kill: close cleanly so the discovery file goes away with the server.
      const stop = (): void => {
        void dashboard.close().then(() => {
          store.close();
          process.exit(0);
        });
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });

  program
    .command('stats')
    .helpGroup('Check:')
    .description('Show how many tokens remimem saved your agent')
    .action(() => {
      console.log(runStats(process.cwd()));
    });

  program
    .command('bench')
    .helpGroup('Contributors:')
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
    .helpGroup('Find code:')
    .description('Find code by meaning or by name, packed into a token budget')
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

  // Help lists groups and commands in the order a new user needs them.
  const rank = (c: Command): number => {
    const i = HELP_ORDER.indexOf(c.name());
    return i === -1 ? HELP_ORDER.length : i;
  };
  // `commands` is typed read-only but is the list help reads, so sorting it in place is the hook.
  (program.commands as Command[]).sort((a, b) => rank(a) - rank(b));

  return program;
}
