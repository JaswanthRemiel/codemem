import { createRequire } from 'node:module';
import { Command } from 'commander';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

/** True when a Node.js version string such as "20.19.0" meets the minimum (20.19.0). */
export function nodeOk(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 20 || (major === 20 && minor >= 19);
}

export function buildProgram(): Command {
  const program = new Command('codemem')
    .description('Local-first code context and project memory for coding agents')
    .version(pkg.version);

  program
    .command('doctor')
    .description('Check that this machine can run codemem')
    .action(() => {
      const version = process.versions.node;
      const ok = nodeOk(version);
      console.log(`Node.js ${version}: ${ok ? 'ok' : 'too old, install Node.js 20.19.0 or newer'}`);
      console.log(
        'Not checked yet (added in later phases): grammars, SQLite extensions, embedding model, index health',
      );
      if (!ok) process.exitCode = 1;
    });

  return program;
}
