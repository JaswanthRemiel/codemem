// Fails if any tracked file contains an em dash or an emoji (project hard rule).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BANNED = new RegExp(String.fromCodePoint(0x2014) + '|\\p{Extended_Pictographic}', 'u');

/** Returns the 1-based line numbers that contain an em dash or an emoji. */
export function badLines(text) {
  return text.split('\n').flatMap((line, i) => (BANNED.test(line) ? [i + 1] : []));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  let failed = false;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // tracked but deleted in the working tree
    }
    if (text.includes('\0')) continue; // binary file
    for (const line of badLines(text)) {
      console.error(`${file}:${line}: em dash or emoji`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log(`check-chars: ${files.length} tracked files clean`);
}
