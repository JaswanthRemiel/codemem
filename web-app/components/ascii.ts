// ASCII art for the landing page. Kept in one place so the drawings stay aligned:
// every line of a drawing is meant to be shown in a monospace font, as is.

/**
 * The web mono font has no box-drawing or shade characters, so drawings that use them are
 * set in one system font; mixing fonts would give their glyphs different widths.
 */
export const SYSTEM_MONO = 'ui-monospace, Menlo, Consolas, monospace';

/** The remimem logo, the same one the CLI prints. */
export const LOGO = [
  '██████╗ ███████╗███╗   ███╗██╗███╗   ███╗███████╗███╗   ███╗',
  '██╔══██╗██╔════╝████╗ ████║██║████╗ ████║██╔════╝████╗ ████║',
  '██████╔╝█████╗  ██╔████╔██║██║██╔████╔██║█████╗  ██╔████╔██║',
  '██╔══██╗██╔══╝  ██║╚██╔╝██║██║██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║',
  '██║  ██║███████╗██║ ╚═╝ ██║██║██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║',
  '╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝╚═╝╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝',
].join('\n');

// The amphora the CLI draws while the embedding model downloads. `#` marks cells to fill.
const AMPHORA = [
  '    .-"""-.    ',
  '   (_______)   ',
  '    )#####(    ',
  '   /#######\\   ',
  '  |#########|  ',
  '  |#########|  ',
  '   \\#######/   ',
  "    `-----'    ",
];
const CELLS = AMPHORA.join('').split('#').length - 1;

/** The amphora filled to `fraction`, bottom row first, as the CLI draws it. */
export function amphora(fraction: number): string[] {
  let toFill = Math.round(Math.min(1, Math.max(0, fraction)) * CELLS);
  const rows = [...AMPHORA];
  for (let r = rows.length - 1; r >= 0; r--) {
    rows[r] = (rows[r] as string).replace(/#/g, () => (toFill-- > 0 ? '▓' : ' '));
  }
  return rows;
}
