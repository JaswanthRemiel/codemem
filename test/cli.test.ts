import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { nodeOk, runDoctor } from '../src/cli/commands.js';
import { buildProgram } from '../src/cli/program.js';
import { copyFixture } from './helpers.js';

test('version matches package.json', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  expect(buildProgram().version()).toBe(pkg.version);
});

test('doctor command is registered', () => {
  expect(buildProgram().commands.map((c) => c.name())).toContain('doctor');
});

test('nodeOk enforces the 22.13.0 minimum', () => {
  expect(nodeOk('20.19.0')).toBe(false);
  expect(nodeOk('22.12.9')).toBe(false);
  expect(nodeOk('22.13.0')).toBe(true);
  expect(nodeOk('24.0.0')).toBe(true);
});

test('doctor checks the runtime, grammars, SQLite, and the embedding setting', async () => {
  const root = copyFixture('go-mod');
  mkdirSync(`${root}/.remimem`);
  writeFileSync(`${root}/.remimem/config.json`, '{ "embedding": { "provider": "none" } }');
  const { lines, ok } = await runDoctor(root);
  expect(ok).toBe(true);
  expect(lines).toEqual([
    `Node.js: ${process.versions.node} ok`,
    'Grammar javascript: ok',
    'Grammar typescript: ok',
    'Grammar tsx: ok',
    'Grammar python: ok',
    'Grammar go: ok',
    'SQLite with FTS5 and sqlite-vec: ok',
    'Embedding model: off (keyword search only)',
    'Index: none yet (run `remimem init` in the project)',
  ]);
});

test('doctor reports a failing check with a fix hint and a failing status', async () => {
  const root = copyFixture('go-mod');
  mkdirSync(`${root}/.remimem`);
  writeFileSync(`${root}/.remimem/config.json`, '{ "embedding": { "provider": "openai" } }');
  vi.stubEnv('OPENAI_API_KEY', '');
  const { lines, ok } = await runDoctor(root);
  vi.unstubAllEnvs();
  expect(ok).toBe(false);
  expect(lines.find((line) => line.startsWith('Embedding model'))).toMatch(
    /failed \(ConfigError: Set OPENAI_API_KEY/,
  );
});
