import { expect, test } from 'vitest';
import { processFile } from '../src/indexer/index.js';
import { scan } from '../src/scanner/index.js';

/** A readable dump of everything the parser and chunker produce for a fixture repo. */
async function render(root: string): Promise<string> {
  const out: string[] = [];
  for (const { path } of scan(root)) {
    const { parsed, chunks } = await processFile(root, path);
    out.push(`# ${path} (${chunks[0]?.language ?? 'line windows'})`);
    if (parsed) {
      const name = (i: number | null): string =>
        i === null ? '<file>' : (parsed.symbols[i]?.qualifiedName ?? '?');
      out.push('symbols:');
      for (const s of parsed.symbols) {
        const doc = s.docstring ? ` doc=${JSON.stringify(s.docstring)}` : '';
        out.push(
          `  ${s.kind} ${s.qualifiedName} ${s.startLine}-${s.endLine} parent=${name(s.parent)}${doc}`,
        );
        for (const line of s.signature.split('\n')) out.push(`    | ${line}`);
      }
      out.push('calls:');
      for (const c of parsed.calls) {
        out.push(
          `  ${name(c.caller)} -> ${c.receiver ? `${c.receiver}.` : ''}${c.callee} (line ${c.line})`,
        );
      }
      out.push('imports:');
      for (const i of parsed.imports)
        out.push(`  ${i.source} [${i.names.join(', ')}] (line ${i.line})`);
    }
    out.push('chunks:');
    for (const c of chunks) {
      out.push(
        `  ${c.startLine}-${c.endLine} ${c.kind} ${c.symbol ?? '-'} sha=${c.contentHash.slice(0, 8)}`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}

test.each(['ts-app', 'py-pkg', 'go-mod'])('golden output for %s', async (fixture) => {
  const dump = await render(`test/fixtures/${fixture}`);
  await expect(dump).toMatchFileSnapshot(`golden/${fixture}.txt`);
});
