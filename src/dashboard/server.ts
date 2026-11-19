// The local dashboard: a small HTTP server on 127.0.0.1 that serves the page and its JSON API.
// The page can change memories, the index, and the config, so every request is checked:
// the Host header must name this server (against DNS rebinding), every API call must carry the
// token from the printed URL, and changes must be JSON from this origin (against cross-site
// forms). Nothing here writes to stdout: under `remimem serve` it belongs to the MCP protocol.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemimemError } from '../errors.js';
import { log } from '../log.js';
import type { ToolContext } from '../mcp/tools.js';
import { handleApi, NotFoundError } from './api.js';

/** Where the built page lives: next to this file, in `ui/`. */
const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), 'ui');
const STATIC: Record<string, [file: string, type: string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
};
const MAX_BODY_BYTES = 1_048_576;

export interface Dashboard {
  /** The address to open, token included. */
  url: string;
  port: number;
  /** Lets the process exit while the dashboard is still open (used under `remimem serve`). */
  unref: () => void;
  close: () => Promise<void>;
}

/** The file that tells `remimem dashboard` where a running server for `root` is. */
export function discoveryFile(root: string): string {
  const id = createHash('sha256').update(root).digest('hex').slice(0, 16);
  return join(tmpdir(), `remimem-dashboard-${id}.json`);
}

/** The running dashboard for `root`, if its server process is still alive. */
export function findDashboard(root: string): { url: string; pid: number } | undefined {
  try {
    const found = JSON.parse(readFileSync(discoveryFile(root), 'utf8')) as {
      url: string;
      pid: number;
    };
    process.kill(found.pid, 0); // throws when the process is gone
    return found;
  } catch {
    return undefined;
  }
}

function sameToken(given: string | undefined, token: string): boolean {
  if (given === undefined || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    // The token is in the page's URL: never leak it in a Referer, never allow framing.
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  });
  res.end(body);
}

const json = (res: ServerResponse, status: number, value: unknown): void =>
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const part of req as AsyncIterable<Buffer>) {
    size += part.length;
    if (size > MAX_BODY_BYTES) throw new RemimemError('Request body too large.');
    parts.push(part);
  }
  const text = Buffer.concat(parts).toString('utf8');
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RemimemError('Request body is not valid JSON.');
  }
}

/**
 * Starts the dashboard for an open project. `port` 0 picks a free port. The URL is written to
 * the discovery file, which is removed again by `close`.
 */
export async function startDashboard(ctx: ToolContext, port = 0): Promise<Dashboard> {
  const token = randomBytes(24).toString('base64url');
  let origins: Set<string> = new Set();
  let hosts: Set<string> = new Set();

  const server = createServer((req, res) => {
    void (async () => {
      const host = req.headers.host ?? '';
      if (!hosts.has(host)) return send(res, 421, 'Unknown host', 'text/plain');
      const url = new URL(req.url ?? '/', `http://${host}`);
      const method = req.method ?? 'GET';

      if (!url.pathname.startsWith('/api/')) {
        const asset = method === 'GET' ? STATIC[url.pathname] : undefined;
        if (!asset) return send(res, 404, 'Not found', 'text/plain');
        try {
          return send(res, 200, readFileSync(join(UI_DIR, asset[0]), 'utf8'), asset[1]);
        } catch {
          return send(
            res,
            500,
            'The dashboard page is missing. Run `npm run build`.',
            'text/plain',
          );
        }
      }

      const given = req.headers['x-remimem-token'];
      if (!sameToken(typeof given === 'string' ? given : undefined, token)) {
        return json(res, 401, {
          error: 'Missing or wrong token. Open the URL that remimem printed.',
        });
      }
      if (method !== 'GET') {
        const origin = req.headers.origin;
        const type = req.headers['content-type'] ?? '';
        if (
          (origin !== undefined && !origins.has(origin)) ||
          !type.startsWith('application/json')
        ) {
          return json(res, 403, {
            error: 'Changes must be JSON requests from the dashboard page.',
          });
        }
      }
      try {
        const body = method === 'GET' ? undefined : await readBody(req);
        json(
          res,
          200,
          await handleApi(ctx, { method, path: url.pathname, query: url.searchParams, body }),
        );
      } catch (error) {
        if (error instanceof RemimemError) {
          return json(res, error instanceof NotFoundError ? 404 : 400, { error: error.message });
        }
        log.error(`dashboard: ${method} ${url.pathname} failed: ${String(error)}`);
        json(res, 500, { error: 'Internal error; see the remimem log.' });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const actual = (server.address() as AddressInfo).port;
  hosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
  origins = new Set([...hosts].map((h) => `http://${h}`));
  const url = `http://127.0.0.1:${actual}/?token=${token}`;

  const file = discoveryFile(ctx.root);
  try {
    writeFileSync(file, JSON.stringify({ url, pid: process.pid }), { mode: 0o600 });
  } catch (error) {
    log.warn(`could not write ${file}: ${String(error)}`);
  }
  log.info(`dashboard at ${url}`);
  // Only remove the discovery file if it still points at this server.
  const cleanup = (): void => {
    if (findDashboard(ctx.root)?.url === url) rmSync(file, { force: true });
  };
  process.once('exit', cleanup);

  return {
    url,
    port: actual,
    unref: () => server.unref(),
    close: async () => {
      process.off('exit', cleanup);
      cleanup();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
