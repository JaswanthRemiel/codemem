import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config/index.js';
import { RemimemError, ConfigError } from '../errors.js';
import type { EmbeddingInput, Store } from '../store/index.js';

export class EmbeddingError extends RemimemError {}

export interface EmbeddingProvider {
  /** `provider:model`, stored with the vectors so a model change is detected. */
  id: string;
  /** False when calling `embed` sends text to another machine. */
  local: boolean;
  /** One unit-length vector per text. `kind` matters only to providers that distinguish it. */
  embed(texts: string[], kind: 'document' | 'query'): Promise<Float32Array[]>;
}

type EmbeddingConfig = Config['embedding'];

const DEFAULT_MODELS = {
  local: 'Xenova/all-MiniLM-L6-v2',
  openai: 'text-embedding-3-small',
  voyage: 'voyage-code-3',
} as const;

const REMOTE = {
  openai: { url: 'https://api.openai.com/v1/embeddings', keyEnv: 'OPENAI_API_KEY' },
  voyage: { url: 'https://api.voyageai.com/v1/embeddings', keyEnv: 'VOYAGE_API_KEY' },
} as const;

/** Where downloaded models are kept. Override with REMIMEM_CACHE_DIR. */
export function modelCacheDir(): string {
  return join(process.env['REMIMEM_CACHE_DIR'] ?? join(homedir(), '.cache', 'remimem'), 'models');
}

function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const x of vector) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return vector.map((x) => x / norm);
}

type DownloadListener = (model: string, loaded: number, total: number) => void;
let downloadListener: DownloadListener | undefined;

/**
 * Lets the CLI draw the first download of a local model. The MCP server never sets it, so
 * nothing extra is ever written while it serves.
 */
export function onModelDownload(listener: DownloadListener | undefined): void {
  downloadListener = listener;
}

/** Sums byte progress across a model's files, and reports it only while files download. */
function progressReporter(model: string): (info: unknown) => void {
  const files = new Map<string, { loaded: number; total: number }>();
  let downloading = false;
  return (info) => {
    const event = info as { status?: string; file?: string; loaded?: number; total?: number };
    // Files read from the cache also report progress; only a real download is shown.
    if (event.status === 'download') downloading = true;
    if (!downloading || !downloadListener || event.status !== 'progress' || !event.file) return;
    files.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    downloadListener(model, loaded, total);
  };
}

function localProvider(model: string, maxTokens: number): EmbeddingProvider {
  // Loaded on first use: importing the runtime and reading the model takes a while.
  let ready: Promise<(texts: string[]) => Promise<Float32Array[]>> | undefined;
  const load = async (): Promise<(texts: string[]) => Promise<Float32Array[]>> => {
    const { AutoModel, AutoTokenizer, env, mean_pooling } =
      await import('@huggingface/transformers');
    env.cacheDir = modelCacheDir();
    const progress_callback = progressReporter(model);
    const tokenizer = await AutoTokenizer.from_pretrained(model, { progress_callback });
    const network = await AutoModel.from_pretrained(model, { dtype: 'q8', progress_callback });
    return async (texts) => {
      const inputs = tokenizer(texts, { padding: true, truncation: true, max_length: maxTokens });
      const output = await network(inputs);
      const pooled = mean_pooling(output.last_hidden_state, inputs.attention_mask);
      const [rows = 0, dim = 0] = pooled.dims;
      const data = pooled.data as Float32Array;
      return Array.from({ length: rows }, (_, i) => normalize(data.slice(i * dim, (i + 1) * dim)));
    };
  };
  return {
    id: `local:${model}`,
    local: true,
    async embed(texts) {
      if (texts.length === 0) return [];
      ready ??= load().catch((cause: unknown) => {
        ready = undefined;
        throw new EmbeddingError(
          `Embedding model ${model} failed to load (the first run downloads it); run \`remimem doctor\``,
          { cause },
        );
      });
      return (await ready)(texts);
    },
  };
}

function remoteProvider(provider: 'openai' | 'voyage', model: string): EmbeddingProvider {
  const { url, keyEnv } = REMOTE[provider];
  return {
    id: `${provider}:${model}`,
    local: false,
    async embed(texts, kind) {
      if (texts.length === 0) return [];
      // Keys come from the environment only, never from the config file.
      const key = process.env[keyEnv];
      if (!key) throw new ConfigError(`Set ${keyEnv} to use the ${provider} embedding provider`);
      const body = JSON.stringify({
        model,
        input: texts,
        ...(provider === 'voyage' ? { input_type: kind } : {}),
      });
      let lastError = '';
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body,
          });
        } catch (error) {
          lastError = String(error);
          continue;
        }
        if (response.ok) {
          const json = (await response.json()) as {
            data: { index: number; embedding: number[] }[];
          };
          return [...json.data]
            .sort((a, b) => a.index - b.index)
            .map((item) => normalize(Float32Array.from(item.embedding)));
        }
        lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
        // Only rate limits and server errors are worth another try.
        if (response.status !== 429 && response.status < 500) break;
      }
      throw new EmbeddingError(`${provider} embedding request failed: ${lastError}`);
    },
  };
}

/** The provider the config asks for, or null when embeddings are turned off. */
export function createProvider(config: EmbeddingConfig): EmbeddingProvider | null {
  if (config.provider === 'none') return null;
  const model = config.model || DEFAULT_MODELS[config.provider];
  return config.provider === 'local'
    ? localProvider(model, config.maxTokens)
    : remoteProvider(config.provider, model);
}

/**
 * The text that is embedded for a chunk: path, signature, docstring, then the body. Local
 * models cut their input after a few hundred tokens, and this order means the cut only ever
 * removes the end of the body.
 */
export function embeddingText(chunk: Omit<EmbeddingInput, 'id'>): string {
  const { path, content, signature, docstring } = chunk;
  if (!signature) return `${path}\n${content}`;
  // Drop the doc comment above the symbol, then the signature the code starts with, so
  // neither appears twice. A later part of a split function also starts with the signature.
  let body = content.split('\n').slice(chunk.docLines).join('\n');
  const wanted = signature.replace(/\s+/g, '');
  let end = 0;
  for (let matched = 0; end < body.length && matched < wanted.length; end++) {
    const ch = body[end] as string;
    if (/\s/.test(ch)) continue;
    if (ch !== wanted[matched]) break;
    matched++;
    if (matched === wanted.length) {
      body = body.slice(end + 1);
      break;
    }
  }
  // shortcut: a Python docstring stays in the body as well, since it is part of the code.
  // Strip it there if the repeated text turns out to cost recall.
  return [path, signature, docstring, body.trim()].filter(Boolean).join('\n');
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex');

export interface EmbedStats {
  /** Chunks that received a vector in this run. */
  embedded: number;
  /** How many of those came from the cache instead of the model. */
  cached: number;
  /** Text hashes of every chunk that received a vector in this run. */
  hashes: Set<string>;
}

/** True when the stored vectors came from a different model than `provider`. */
export function modelChanged(store: Store, provider: EmbeddingProvider): boolean {
  const stored = store.embeddingModel();
  return stored !== undefined && stored !== provider.id;
}

/**
 * Gives every chunk that lacks a vector one, reusing cached vectors for text that was
 * embedded before. Safe to interrupt: the next run continues with what is still missing.
 */
export async function embedMissing(
  store: Store,
  provider: EmbeddingProvider,
  batchSize: number,
  onProgress?: (done: number, total: number) => void,
): Promise<EmbedStats> {
  if (modelChanged(store, provider)) {
    throw new EmbeddingError(
      `The index holds vectors from ${store.embeddingModel()} but the configured model is ${provider.id}; run \`remimem index --full\` to rebuild them`,
    );
  }
  const stats: EmbedStats = { embedded: 0, cached: 0, hashes: new Set() };
  // Cheap check first: finding the chunks that lack a vector scans the whole table.
  if (store.embeddingModel() !== undefined && store.vectorCount() === store.counts().chunks) {
    return stats;
  }
  const pending = store.chunksWithoutVectors();
  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize).map((chunk) => {
      const text = embeddingText(chunk);
      const hash = hashOf(text);
      return { id: chunk.id, text, hash, vector: store.cachedEmbedding(hash, provider.id) };
    });
    const misses = batch.filter((item) => !item.vector);
    const fresh = await provider.embed(
      misses.map((item) => item.text),
      'document',
    );
    if (fresh.length !== misses.length) {
      throw new EmbeddingError(
        `${provider.id} returned ${fresh.length} vectors for ${misses.length} texts`,
      );
    }
    for (const [i, item] of misses.entries()) item.vector = fresh[i];
    const first = batch[0]?.vector;
    if (first && store.embeddingModel() === undefined)
      store.resetVectors(provider.id, first.length);
    store.transaction(() => {
      for (const item of batch) {
        const vector = item.vector as Float32Array;
        store.setVector(item.id, vector);
        if (misses.includes(item)) store.cacheEmbedding(item.hash, provider.id, vector);
      }
    });
    for (const item of batch) stats.hashes.add(item.hash);
    stats.embedded += batch.length;
    stats.cached += batch.length - misses.length;
    onProgress?.(stats.embedded, pending.length);
  }
  return stats;
}
