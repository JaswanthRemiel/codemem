import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { buildProgram, nodeOk } from '../src/cli/program.js';

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
