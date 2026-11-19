// Bundles the dashboard page into dist/dashboard/ui/: the script with Cytoscape.js inlined,
// the stylesheet, and the HTML. Run by `npm run build` after tsc.
import { copyFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const src = 'src/dashboard/ui';
const out = 'dist/dashboard/ui';
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [`${src}/app.ts`, `${src}/app.css`],
  outdir: out,
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'linked',
  logLevel: 'warning',
});
copyFileSync(`${src}/index.html`, `${out}/index.html`);
