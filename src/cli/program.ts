import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { Command } from 'commander';
import { processFile } from '../indexer/index.js';
import { runIndex, runSearch } from './commands.js';
import { LANGS, parseSource } from '../parser/index.js';
import { resolveInRoot, scan } from '../scanner/index.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

/** True when a Node.js version string such as "22.13.0" meets the minimum (22.13.0). */
export function nodeOk(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

export function buildProgram(): Command {
  const program = new Command('codemem')
    .description('Local-first code context and project memory for coding agents')
    .version(pkg.version);

  program
    .command('doctor')
    .description('Check that this machine can run codemem')
    .action(async () => {
      const version = process.versions.node;
      let ok = nodeOk(version);
      console.log(`Node.js ${version}: ${ok ? 'ok' : 'too old, install Node.js 22.13.0 or newer'}`);
      for (const lang of LANGS) {
        try {
          await parseSource(lang, '');
          console.log(`Grammar ${lang}: ok`);
        } catch (error) {
          ok = false;
          const cause =
            error instanceof Error && error.cause instanceof Error ? error.cause : error;
          console.log(`Grammar ${lang}: failed (${String(cause)}), reinstall codemem`);
        }
      }
      console.log(
        'Not checked yet (added in later phases): SQLite extensions, embedding model, index health',
      );
      if (!ok) process.exitCode = 1;
    });

  program
    .command('index')
    .description('Index the current directory, skipping files that have not changed')
    .option('--full', 'reindex every file')
    .action(async (options: { full?: boolean }) => {
      console.log(await runIndex(process.cwd(), options));
    });

  program
    .command('search <query>')
    .description('Search the index by keyword')
    .option('-k, --limit <n>', 'number of results', '10')
    .option('--debug', 'print scores')
    .action((query: string, options: { limit: string; debug?: boolean }) => {
      console.log(
        runSearch(process.cwd(), query, { k: Number(options.limit), debug: options.debug }),
      );
    });

  // Hidden developer commands, not part of the public interface.
  program
    .command('debug', { hidden: true })
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
