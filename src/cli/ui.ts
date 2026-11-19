// Presentation for people at a terminal: the banner, colors, and progress drawings.
// Everything here writes nothing on its own; callers decide where text goes, and the MCP
// server never uses this module, because its stdout belongs to the protocol.
import { styleText } from 'node:util';

type Style = Parameters<typeof styleText>[0];

/** Colors only when the stream is a terminal; honors NO_COLOR and FORCE_COLOR. */
export function paint(
  style: Style,
  text: string,
  stream: NodeJS.WriteStream = process.stdout,
): string {
  return styleText(style, text, { validateStream: true, stream });
}

const LOGO = [
  '██████╗ ███████╗███╗   ███╗██╗███╗   ███╗███████╗███╗   ███╗',
  '██╔══██╗██╔════╝████╗ ████║██║████╗ ████║██╔════╝████╗ ████║',
  '██████╔╝█████╗  ██╔████╔██║██║██╔████╔██║█████╗  ██╔████╔██║',
  '██╔══██╗██╔══╝  ██║╚██╔╝██║██║██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║',
  '██║  ██║███████╗██║ ╚═╝ ██║██║██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║',
  '╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝╚═╝╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝',
];

/** For terminals narrower than the full logo. */
const LOGO_SMALL = [
  '                _                 ',
  '  _ _ ___ _ __ (_)_ __  ___ _ __  ',
  " | '_/ -_) '  \\| | '  \\/ -_) '  \\ ",
  ' |_| \\___|_|_|_|_|_|_|_\\___|_|_|_|',
];

/** The remimem logo, the tagline, and the version, sized to the terminal. */
export function banner(version: string, stream: NodeJS.WriteStream = process.stdout): string {
  const logo = (stream.columns ?? 80) >= 64 ? LOGO : LOGO_SMALL;
  return [
    '',
    ...logo.map((line) => paint('yellow', line, stream)),
    '',
    `${paint('bold', 'codebase memory for coding agents', stream)}  ${paint('dim', `v${version}`, stream)}`,
    '',
  ].join('\n');
}

/** A horizontal bar such as `██████████░░░░░░░░░░`, for a fraction from 0 to 1. */
export function bar(fraction: number, width = 24): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// An amphora, Mnemosyne's vessel, that fills from the bottom as the model downloads.
// `#` marks the cells inside it that fill up.
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
const AMPHORA_CELLS = AMPHORA.join('').split('#').length - 1;

/** The amphora filled to `fraction`, bottom row first, left to right. */
export function amphora(fraction: number): string[] {
  let toFill = Math.round(Math.min(1, Math.max(0, fraction)) * AMPHORA_CELLS);
  const rows = [...AMPHORA];
  for (let r = rows.length - 1; r >= 0; r--) {
    rows[r] = (rows[r] as string).replace(/#/g, () => (toFill-- > 0 ? '▓' : ' '));
  }
  return rows;
}

const mb = (bytes: number): string => (bytes / 1_048_576).toFixed(1);
const MIN_DRAW_BYTES = 2 * 1_048_576;

/**
 * Draws the download of the embedding model on stderr: the amphora on the left, the model
 * name and byte counts beside it, redrawn in place. Does nothing when stderr is not a
 * terminal. Returns `finish`, which leaves the full drawing on screen.
 */
export function downloadDisplay(model: string): {
  update: (loaded: number, total: number) => void;
  finish: () => void;
} {
  const out = process.stderr;
  if (!out.isTTY) return { update: () => undefined, finish: () => undefined };
  let drawn = false;
  let lastDraw = 0;
  let last = { loaded: 0, total: 0 };

  const draw = (loaded: number, total: number): void => {
    const fraction = total > 0 ? loaded / total : 0;
    const side = [
      '',
      '',
      paint('bold', 'Downloading the embedding model', out),
      paint('dim', `${model}, downloaded once, then cached`, out),
      '',
      `${paint('yellow', bar(fraction, 28), out)}  ${Math.round(fraction * 100)}%`,
      paint('dim', `${mb(loaded)} of ${mb(total)} MB`, out),
      '',
    ];
    const lines = amphora(fraction).map(
      (row, i) => `  ${paint('yellow', row, out)}  ${side[i] ?? ''}`,
    );
    // Move back up over the previous drawing, then redraw every line.
    if (drawn) out.write(`\x1b[${lines.length}A`);
    out.write(`${lines.map((line) => `\r\x1b[K${line}`).join('\n')}\n`);
    drawn = true;
  };

  return {
    update(loaded, total) {
      last = { loaded, total };
      // Small files (tokenizer, config) come first and would read as 100% at once; the
      // drawing starts with the model weights. Redraws are capped at about ten a second.
      const now = Date.now();
      if (total < MIN_DRAW_BYTES || (now - lastDraw < 100 && loaded < total)) return;
      lastDraw = now;
      draw(loaded, total);
    },
    finish() {
      if (drawn) draw(last.total, last.total);
    },
  };
}

/** A one-line bar for embedding progress, redrawn in place on stderr. */
export function embedProgress(done: number, total: number): void {
  const out = process.stderr;
  if (!out.isTTY) return;
  const fraction = done / Math.max(total, 1);
  out.write(
    `\r\x1b[K  ${paint('dim', 'Embedding', out)} ${paint('yellow', bar(fraction), out)} ${done}/${total} chunks`,
  );
}

/** Clears the current line on stderr, after a progress bar. */
export function clearLine(): void {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
}

/** What a bare `remimem` prints: the banner and the few commands that matter first. */
export function welcome(version: string, initialized: boolean): string {
  const cmd = (text: string): string => paint('cyan', text);
  const step = (n: number, text: string, command: string): string =>
    `  ${paint('dim', `${n}.`)} ${text}\n     ${cmd(command)}`;
  const lines = [banner(version)];
  if (initialized) {
    lines.push(
      `${paint('green', '✓')} This project is set up. A few things to try:`,
      '',
      `  ${cmd('remimem search "how are requests authenticated"')}   find code`,
      `  ${cmd('remimem context "add rate limiting to login"')}      context for a task`,
      `  ${cmd('remimem stats')}                                     what it saved`,
      `  ${cmd('remimem doctor')}                                    check the setup`,
    );
  } else {
    lines.push(
      'Get started in this project:',
      '',
      step(1, 'Index the code and get your client configuration', 'remimem init'),
      '',
      step(
        2,
        'Connect your agent (Claude Code shown)',
        'claude mcp add remimem -- npx -y remimem serve',
      ),
      '',
      step(3, 'Ask it something', 'remimem search "where is the config loaded"'),
    );
  }
  lines.push(
    '',
    `${paint('dim', 'All commands:')} ${cmd('remimem --help')}    ${paint('dim', 'Docs:')} ${paint('underline', 'https://github.com/JaswanthRemiel/remimem')}`,
    '',
  );
  return lines.join('\n');
}
