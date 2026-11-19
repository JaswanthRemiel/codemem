#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import { onModelDownload } from '../embedder/index.js';
import { RemimemError } from '../errors.js';
import { buildProgram } from './program.js';
import { downloadDisplay, paint, welcome } from './ui.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

// Exit quietly when the reader goes away, as in `remimem search x | head`.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error;
  process.exit(0);
});

const command = process.argv[2];

// A bare `remimem` greets the user instead of printing an error and the full help.
if (command === undefined) {
  console.log(welcome(pkg.version, existsSync(join(process.cwd(), CONFIG_DIR, 'index.db'))));
  process.exit(0);
}

// The MCP server talks over stdio, so it never draws anything.
if (command !== 'serve') {
  let display: ReturnType<typeof downloadDisplay> | undefined;
  onModelDownload((model, loaded, total) => {
    display ??= downloadDisplay(model);
    display.update(loaded, total);
  });
}

try {
  await buildProgram().parseAsync();
} catch (error) {
  if (!(error instanceof RemimemError)) throw error;
  console.error(`${paint('red', 'error:', process.stderr)} ${error.message}`);
  process.exitCode = 1;
}
