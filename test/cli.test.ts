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

test('nodeOk enforces the 20.19.0 minimum', () => {
  expect(nodeOk('18.20.0')).toBe(false);
  expect(nodeOk('20.18.9')).toBe(false);
  expect(nodeOk('20.19.0')).toBe(true);
  expect(nodeOk('22.0.0')).toBe(true);
});
