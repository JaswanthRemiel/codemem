import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ConfigError } from '../errors.js';

export const CONFIG_DIR = '.codemem';

// Fields are added here as the phases that use them arrive. Unknown keys are rejected so
// a typo does not silently fall back to a default.
const ConfigSchema = z.strictObject({
  /** Globs a file must match to be indexed. Empty means every file. */
  include: z.array(z.string()).default([]),
  /** Globs that remove files from the index, on top of the built-in excludes. */
  exclude: z.array(z.string()).default([]),
  maxFileSizeKb: z.number().int().positive().default(512),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Validates a raw config object and fills in defaults. */
export function parseConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid ${CONFIG_DIR}/config.json:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Loads `.codemem/config.json` under `root`, or the defaults when it does not exist. */
export function loadConfig(root: string): Config {
  let text: string;
  try {
    text = readFileSync(join(root, CONFIG_DIR, 'config.json'), 'utf8');
  } catch {
    return parseConfig({});
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new ConfigError(`${CONFIG_DIR}/config.json is not valid JSON: ${String(cause)}`);
  }
  return parseConfig(raw);
}
