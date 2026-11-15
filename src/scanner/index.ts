import { execFileSync } from 'node:child_process';
import { closeSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { PathError } from '../errors.js';

export interface ScannedFile {
  /** Path relative to the root, with forward slashes. */
  path: string;
  sizeBytes: number;
  /** Last modification time, in milliseconds since the epoch. */
  mtimeMs: number;
}

export interface ScanOptions {
  maxFileSizeKb: number;
  /** Globs a file must match. Empty means every file. */
  include: string[];
  /** Globs that remove files, on top of the built-in excludes. */
  exclude: string[];
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = { maxFileSizeKb: 512, include: [], exclude: [] };

const EXCLUDED_DIRS = new Set([
  '.git',
  '.remimem',
  'node_modules',
  'dist',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  'coverage',
]);
const LOCKFILES =
  /^(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|bun\.lockb|go\.sum|.*\.lock)$/;
const GENERATED_NAME = /(\.min\.(js|css)|\.map|\.pb\.go|_pb2(_grpc)?\.pyi?)$|\.generated\./;
const SECRETS =
  /^(\.env.*|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519).*|.*\.(pem|key|p12|pfx|jks|keystore))$/;
const GENERATED_HEADER = /Code generated .* DO NOT EDIT|@generated/;
const HEAD_BYTES = 8192;

/** True when the path is vendored, generated, a lockfile, or looks like a secret. */
export function isExcludedPath(path: string): boolean {
  const parts = path.split('/');
  const base = parts.pop() as string;
  return (
    parts.some((dir) => EXCLUDED_DIRS.has(dir)) ||
    LOCKFILES.test(base) ||
    GENERATED_NAME.test(base) ||
    SECRETS.test(base)
  );
}

/** Resolves `path` against `root` and rejects anything outside it, following symlinks. */
export function resolveInRoot(root: string, path: string): string {
  const realRoot = realpathSync(root);
  let target = resolve(realRoot, path);
  try {
    target = realpathSync(target);
  } catch {
    // The file does not exist; the lexical check below still applies.
  }
  const rel = relative(realRoot, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new PathError(`Path is outside the repository root: ${path}`);
  }
  return target;
}

function listFiles(root: string): string[] {
  try {
    // Tracked files plus untracked files that .gitignore does not exclude.
    return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    // shortcut: without git, .gitignore is not read, only the built-in excludes apply.
    // Add a .gitignore parser if non-git folders turn out to matter.
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name)) walk(rel);
        } else if (entry.isFile()) {
          out.push(rel);
        }
      }
    };
    walk('');
    return out;
  }
}

/** True for binary, minified, or generated content, judged from the first bytes of the file. */
export function hasExcludedContent(file: string): boolean {
  const buffer = Buffer.alloc(HEAD_BYTES);
  const fd = openSync(file, 'r');
  let length: number;
  try {
    length = readSync(fd, buffer, 0, HEAD_BYTES, 0);
  } finally {
    closeSync(fd);
  }
  const head = buffer.subarray(0, length);
  if (head.includes(0)) return true;
  const text = head.toString('utf8');
  const minified = text.length >= 2000 && !text.slice(0, 2000).includes('\n');
  return minified || GENERATED_HEADER.test(text.slice(0, 1000));
}

/**
 * Files under `root` that pass every check on name, type, and size, sorted by path. Their
 * content has not been looked at yet: see `hasExcludedContent`.
 */
export function listCandidates(root: string, options: Partial<ScanOptions> = {}): ScannedFile[] {
  const opts = { ...DEFAULT_SCAN_OPTIONS, ...options };
  const matches = (globs: string[], path: string): boolean =>
    globs.some((glob) => matchesGlob(path, glob));
  const files: ScannedFile[] = [];
  for (const listed of new Set(listFiles(root))) {
    const path = listed.split(sep).join('/');
    if (isExcludedPath(path) || matches(opts.exclude, path)) continue;
    if (opts.include.length > 0 && !matches(opts.include, path)) continue;
    try {
      const stat = lstatSync(join(root, path));
      if (!stat.isFile()) continue; // symlinks, submodules, deleted files
      if (stat.size === 0 || stat.size > opts.maxFileSizeKb * 1024) continue;
      files.push({ path, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      continue;
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Lists the files worth indexing under `root`, sorted by path. */
export function scan(root: string, options: Partial<ScanOptions> = {}): ScannedFile[] {
  return listCandidates(root, options).filter((file) => !hasExcludedContent(join(root, file.path)));
}
