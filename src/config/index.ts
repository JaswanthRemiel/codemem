import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ConfigError } from '../errors.js';

export const CONFIG_DIR = '.codemem';

const EmbeddingSchema = z.strictObject({
  /** `local` runs on this machine. `openai` and `voyage` send code to that service. `none` disables vectors. */
  provider: z.enum(['local', 'openai', 'voyage', 'none']).default('local'),
  /** Model name. Empty means the provider's default. */
  model: z.string().default(''),
  batchSize: z.number().int().positive().default(8),
  /** Local models only: inputs are cut to this many model tokens. */
  maxTokens: z.number().int().positive().default(256),
});

const RetrievalSchema = z.strictObject({
  /** Reciprocal rank fusion constant: larger values flatten the difference between ranks. */
  rrfK: z.number().positive().default(60),
  /** Candidates taken from keyword search before fusion. */
  keywordLimit: z.number().int().positive().default(50),
  /** Candidates taken from vector search before fusion. */
  vectorLimit: z.number().int().positive().default(50),
  /** BM25 column weights. */
  keywordWeights: z
    .strictObject({
      content: z.number().nonnegative().default(1),
      symbol: z.number().nonnegative().default(5),
      path: z.number().nonnegative().default(2),
    })
    .prefault({}),
  /** Results returned when the caller does not say how many. */
  defaultK: z.number().int().positive().default(10),
  defaultBudgetTokens: z.number().int().positive().default(4000),
  /** Results `get_context` considers before packing; the budget decides how many are shown. */
  contextK: z.number().int().positive().default(20),
  /** The most project memories `get_context` adds from a search of the task text. */
  memoryLimit: z.number().int().nonnegative().default(5),
  /** A memory found only by vector search needs at least this cosine similarity to the task. */
  memoryMinSimilarity: z.number().min(0).max(1).default(0.3),
  /** A memory found only by keyword search must contain at least this share of the task's terms. */
  memoryMinKeywordMatch: z.number().min(0).max(1).default(0.5),
  /** Graph expansion: how many top results get their neighbors added. */
  graphTopN: z.number().int().nonnegative().default(10),
  /** Graph expansion: the most neighbors added in total. */
  graphMaxNeighbors: z.number().int().nonnegative().default(20),
  /** Graph expansion: neighbor score = parent score x the weight of the edge's confidence. */
  edgeWeights: z
    .strictObject({
      exact: z.number().nonnegative().default(0.5),
      import: z.number().nonnegative().default(0.4),
      'name-match': z.number().nonnegative().default(0.2),
    })
    .prefault({}),
});

// Unknown keys are rejected so a typo does not silently fall back to a default.
const ConfigSchema = z.strictObject({
  /** Globs a file must match to be indexed. Empty means every file. */
  include: z.array(z.string()).default([]),
  /** Globs that remove files from the index, on top of the built-in excludes. */
  exclude: z.array(z.string()).default([]),
  maxFileSizeKb: z.number().int().positive().default(512),
  embedding: EmbeddingSchema.prefault({}),
  retrieval: RetrievalSchema.prefault({}),
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
