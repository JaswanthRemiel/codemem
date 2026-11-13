// All diagnostics go to stderr: stdout belongs to the MCP protocol when `serve` is running.
const LEVELS = ['error', 'warn', 'info', 'debug'] as const;
type Level = (typeof LEVELS)[number];

function enabled(level: Level): boolean {
  const wanted = LEVELS.indexOf((process.env['CODEMEM_LOG_LEVEL'] ?? 'warn') as Level);
  return LEVELS.indexOf(level) <= (wanted === -1 ? 1 : wanted);
}

function write(level: Level, message: string): void {
  if (enabled(level)) process.stderr.write(`codemem ${level}: ${message}\n`);
}

export const log = {
  error: (message: string): void => write('error', message),
  warn: (message: string): void => write('warn', message),
  info: (message: string): void => write('info', message),
  debug: (message: string): void => write('debug', message),
};
