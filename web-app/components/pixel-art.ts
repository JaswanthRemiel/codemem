// Pixel art for the landing page, one string per row: '#' is a lit pixel, '.' is empty.
// Every frame of a sprite has the same size, so the frames can play as a sprite sheet.

export type Frame = string[];

/** Athena's owl: open, blinking, and glancing to each side. */
const OWL_OPEN: Frame = [
  '#.........#',
  '##.......##',
  '###########',
  '#...#.#...#',
  '#.#.#.#.#.#',
  '#...###...#',
  '#####.#####',
  '###########',
  '##.#####.##',
  '###########',
  '.#########.',
  '..##...##..',
];
const OWL_BLINK: Frame = OWL_OPEN.map((row, i) =>
  i === 3 || i === 5 ? '###########' : i === 4 ? '#...###...#' : row,
);
const OWL_LEFT: Frame = OWL_OPEN.map((row, i) => (i === 4 ? '##..#.##..#' : row));
const OWL_RIGHT: Frame = OWL_OPEN.map((row, i) => (i === 4 ? '#..##.#..##' : row));

/** Mostly still, with a blink and a look around: an owl keeping watch. */
export const OWL: Frame[] = [
  OWL_OPEN,
  OWL_OPEN,
  OWL_OPEN,
  OWL_BLINK,
  OWL_OPEN,
  OWL_OPEN,
  OWL_LEFT,
  OWL_LEFT,
  OWL_OPEN,
  OWL_RIGHT,
  OWL_RIGHT,
  OWL_OPEN,
];

/** A flying bird, wings up and down. */
export const BIRD: Frame[] = [
  ['#.....#', '.#...#.', '..#.#..', '...#...'],
  ['.......', '.......', '###.###', '...#...'],
];

// The amphora the CLI fills while the model downloads. 'o' marks the inside, which fills.
const AMPHORA_SHAPE: Frame = [
  '...#######...',
  '....#ooo#....',
  '.##.#ooo#.##.',
  '#..#ooooo#..#',
  '#.#ooooooo#.#',
  '.#ooooooooo#.',
  '.#ooooooooo#.',
  '.#ooooooooo#.',
  '..#ooooooo#..',
  '...#ooooo#...',
  '....#####....',
];

/** The amphora with its inside filled `level` rows up from the bottom. */
function fill(level: number): Frame {
  const rows = AMPHORA_SHAPE.length;
  return AMPHORA_SHAPE.map((row, i) => row.replaceAll('o', i >= rows - 1 - level ? '#' : '.'));
}

/** The amphora filling, then holding full for a moment. */
export const AMPHORA: Frame[] = [
  ...Array.from({ length: 10 }, (_, level) => fill(level)),
  fill(9),
  fill(9),
];

const COLUMN_FULL: Frame = [
  '#########',
  '.#######.',
  '..#.#.#..',
  '..#.#.#..',
  '..#.#.#..',
  '..#.#.#..',
  '..#.#.#..',
  '..#.#.#..',
  '..#.#.#..',
  '.#######.',
  '#########',
];

/** A column raised stone by stone from the base, then holding complete. */
export const COLUMN: Frame[] = [
  ...Array.from({ length: COLUMN_FULL.length }, (_, built) =>
    COLUMN_FULL.map((row, i) =>
      i >= COLUMN_FULL.length - 1 - built ? row : '.'.repeat(row.length),
    ),
  ),
  COLUMN_FULL,
  COLUMN_FULL,
  COLUMN_FULL,
];
