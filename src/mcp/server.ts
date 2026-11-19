import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CONFIG_DIR, loadConfig } from '../config/index.js';
import { startDashboard } from '../dashboard/server.js';
import { createProvider } from '../embedder/index.js';
import { RemimemError } from '../errors.js';
import { log } from '../log.js';
import { Store } from '../store/index.js';
import { runTool, TOOLS, type ToolContext } from './tools.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

export const OVERVIEW_URI = 'remimem://overview';

const INSTRUCTIONS =
  'remimem serves code from a local index of this repository. Start a task with get_context; ' +
  'use search_code for a specific lookup, get_symbol to read a body or see callers and callees, ' +
  'and find_references before changing a symbol. Results cite path:start-end. Save lasting ' +
  'decisions and conventions with remember; get_context shows them again in later sessions.';

/** An MCP server with every remimem tool and the overview resource. */
export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: 'remimem', version: pkg.version },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.shape,
        annotations: { readOnlyHint: tool.readOnly, openWorldHint: false },
      },
      async (args: unknown) => {
        const started = performance.now();
        try {
          const text = await runTool(ctx, tool, (args ?? {}) as Record<string, unknown>);
          log.debug(`${tool.name} answered in ${Math.round(performance.now() - started)} ms`);
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          // A tool failure is an answer for the agent, never a crash of the server.
          if (!(error instanceof RemimemError)) log.error(`${tool.name} failed: ${String(error)}`);
          const message = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
        }
      },
    );
  }

  server.registerResource(
    'overview',
    OVERVIEW_URI,
    {
      title: 'Repository overview',
      description: 'Directory tree with the most-referenced symbols per directory.',
      mimeType: 'text/plain',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/plain',
          text: ctx.store.getMeta('overview') ?? 'No overview yet. Run `remimem index` first.',
        },
      ],
    }),
  );
  return server;
}

/** `remimem serve`: runs the server on stdio until the client disconnects. */
export async function serve(root: string): Promise<void> {
  const config = loadConfig(root);
  mkdirSync(join(root, CONFIG_DIR), { recursive: true });
  const store = new Store(join(root, CONFIG_DIR, 'index.db'));
  const ctx: ToolContext = { root, config, store, provider: createProvider(config.embedding) };
  // The dashboard is a convenience: if its port cannot be opened, the tools still work.
  const dashboard = config.dashboard.enabled
    ? await startDashboard(ctx, config.dashboard.port).catch((error: unknown) => {
        log.warn(`dashboard not started: ${String(error)}`);
        return undefined;
      })
    : undefined;
  // The dashboard lives as long as the agent's session: it never keeps the process alive.
  dashboard?.unref();
  ctx.dashboardUrl = dashboard?.url;
  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    void dashboard?.close();
    store.close();
  };
  await server.connect(transport);
  log.info(`serving ${root} over stdio`);
}
