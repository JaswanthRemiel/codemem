export const SALT = 'fixture-salt';

/** Hashes a password with the fixture salt. */
export default function hash(input: string): string {
  let total = 0;
  for (const char of SALT + input) {
    total = (total * 31 + char.charCodeAt(0)) % 1_000_003;
  }
  return total.toString(16);
}
