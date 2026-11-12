#!/usr/bin/env node
import { CodememError } from '../errors.js';
import { buildProgram } from './program.js';

try {
  await buildProgram().parseAsync();
} catch (error) {
  if (!(error instanceof CodememError)) throw error;
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
