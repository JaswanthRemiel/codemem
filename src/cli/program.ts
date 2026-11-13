import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { Command } from 'commander';
import { processFile } from '../indexer/index.js';
import { runDoctor, runIndex, runRefs, runSearch, runSymbol } from './commands.js';
import { resolveInRoot, scan } from '../scanner/index.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

export function buildProgram(): Command {
  const program = new Command('codemem')
    .description('Local-first code context and project memory for coding agents')
    .version(pkg.version);

  program
    .command('doctor')
    .description('Check that this machine can run codemem')
    .action(async () => {
      const { lines, ok } = await runDoctor(process.cwd());
      console.log(lines.join('\n'));
      if (!ok) process.exitCode = 1;
    });

  program
    .command('index')
    .description('Index the current directory, skipping files that have not changed')
    .option('--full', 'reindex every file and rebuild vectors')
    .action(async (options: { full?: boolean }) => {
      const tty = process.stderr.isTTY;
      const onEmbedProgress = (done: number, total: number): void => {
        if (tty) process.stderr.write(`\rEmbedding ${done}/${total}`);
      };
      const summary = await runIndex(process.cwd(), { ...options, onEmbedProgress });
      if (tty) process.stderr.write('\r\x1b[K');
      console.log(summary);
    });

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
