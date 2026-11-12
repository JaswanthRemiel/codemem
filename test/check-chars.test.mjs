import { expect, test } from 'vitest';
import { badLines } from '../scripts/check-chars.mjs';

test('flags em dashes and emojis by line, and nothing else', () => {
  const emDash = String.fromCodePoint(0x2014);
  const emoji = String.fromCodePoint(0x1f600);
  expect(badLines(`fine\na ${emDash} b\nok - still ok\n${emoji}`)).toEqual([2, 4]);
  expect(badLines('plain ASCII, digits 123, # and * are fine')).toEqual([]);
});
