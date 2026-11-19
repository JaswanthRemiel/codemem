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

test('the amphora fills from the bottom, cell by cell', async () => {
  const { amphora, bar } = await import('../src/cli/ui.js');
  const cells = (rows: string[]): number => rows.join('').split('▓').length - 1;
  expect(cells(amphora(0))).toBe(0);
  const full = amphora(1);
  expect(cells(full)).toBe(37);
  expect(full.join('\n')).not.toContain('#');
  // Half full: the bottom rows fill first, the neck stays empty.
  const half = amphora(0.5);
  expect(cells(half)).toBe(19);
  expect(half[2]).not.toContain('▓');
  expect(half[6]).toContain('▓▓▓▓▓▓▓');
  // Out-of-range input is clamped.
  expect(cells(amphora(2))).toBe(37);
  expect(bar(0.5, 10)).toBe('█████░░░░░');
  expect(bar(-1, 4)).toBe('░░░░');
});

test('a bare remimem greets instead of failing, and help lists commands in a useful order', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const cli = 'dist/cli/index.js';
  const cwd = mkdtempSync(`${tmpdir()}/remimem-welcome-`);
  const welcome = execFileSync(process.execPath, [`${process.cwd()}/${cli}`], {
    cwd,
    encoding: 'utf8',
  });
  // Not a terminal: plain text, no color codes.
  expect(welcome).not.toContain('\x1b[');
  expect(welcome).toContain('Get started in this project:');
  expect(welcome).toContain('remimem init');

  const help = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  const groups = [...help.matchAll(/^([A-Z][A-Za-z ]+):$/gm)].map((m) => m[1]);
  expect(groups).toEqual([
    'Options',
    'Get started',
    'Find code',
    'Project memory',
    'Keep the index fresh',
    'Check',
    'For MCP clients',
    'Contributors',
    'Examples',
  ]);
  // The logo is only shown to a person at a terminal.
  expect(help).not.toContain('███');
});
