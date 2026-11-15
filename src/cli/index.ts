#!/usr/bin/env node
import { RemimemError } from '../errors.js';
import { buildProgram } from './program.js';

// Exit quietly when the reader goes away, as in `remimem search x | head`.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error;
  process.exit(0);
});

try {
  await buildProgram().parseAsync();
} catch (error) {
  if (!(error instanceof RemimemError)) throw error;
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
