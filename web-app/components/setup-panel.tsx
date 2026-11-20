'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';

const tabs = [
  {
    label: 'Claude Code',
    lines: ['npx -y remimem init', 'claude mcp add remimem -- npx -y remimem serve'],
  },
  {
    label: 'Cursor',
    lines: [
      'npx -y remimem init',
      '# .cursor/mcp.json',
      '{ "mcpServers": { "remimem": {',
      '  "command": "npx", "args": ["-y", "remimem", "serve"] } } }',
    ],
  },
  {
    label: 'VS Code',
    lines: [
      'npx -y remimem init',
      '# .mcp.json in the workspace root',
      '{ "mcpServers": { "remimem": { "type": "stdio",',
      '  "command": "npx", "args": ["-y", "remimem", "serve"] } } }',
    ],
  },
  {
    label: 'CLI',
    lines: [
      'npx -y remimem init',
      'npx -y remimem context "add rate limiting to login"',
      'npx -y remimem stats',
    ],
  },
];

/** Characters typed per frame; the longest tab takes about a second and a half. */
const CHARS_PER_TICK = 2;
const TICK_MS = 16;

/** The hero's setup snippet: one tab per client, typed out, with a copy button. */
export function SetupPanel() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const tab = tabs[active] ?? tabs[0];
  const total = tab.lines.join('\n').length;
  // The server renders the full text; the client types it out.
  const [typed, setTyped] = useState(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setTyped(0);
  }, [active]);

  useEffect(() => {
    if (typed >= total) return;
    const timer = setTimeout(() => setTyped((n) => n + CHARS_PER_TICK), TICK_MS);
    return () => clearTimeout(timer);
  }, [typed, total]);

  async function copy() {
    // Comment lines are explanations, not commands.
    const text = tab.lines.filter((line) => !line.startsWith('#')).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the text is still selectable.
    }
  }

  // How much of each line is visible, given the characters typed so far.
  let remaining = typed;
  const visible = tab.lines.map((line) => {
    const shown = line.slice(0, Math.max(0, remaining));
    remaining -= line.length + 1;
    return shown;
  });
  const cursorLine =
    typed >= total
      ? tab.lines.length - 1
      : visible.findIndex((v, i) => v.length < (tab.lines[i]?.length ?? 0));

  return (
    <div className="w-full overflow-hidden rounded-xl border bg-fd-card text-left shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between border-b px-2">
        <div role="tablist" aria-label="Setup instructions" className="flex overflow-x-auto">
          {tabs.map((t, i) => (
            <button
              key={t.label}
              role="tab"
              type="button"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
                i === active
                  ? 'border-fd-primary text-fd-foreground'
                  : 'border-transparent text-fd-muted-foreground hover:text-fd-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy to clipboard'}
          className="press rounded-md p-2 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
        >
          {copied ? (
            <Check strokeWidth={1.5} className="size-4 text-fd-primary" />
          ) : (
            <Copy strokeWidth={1.5} className="size-4" />
          )}
        </button>
      </div>
      {/* The full text for screen readers; the typed copy is decoration. */}
      <pre className="sr-only">{tab.lines.join('\n')}</pre>
      <pre aria-hidden className="overflow-x-auto p-4 font-mono text-[13px] leading-6">
        {tab.lines.map((line, i) => (
          <div key={i} className="flex min-h-6">
            <span className="mr-4 w-4 shrink-0 select-none text-right text-fd-muted-foreground/50">
              {i + 1}
            </span>
            <span className={line.startsWith('#') ? 'text-fd-muted-foreground' : ''}>
              {visible[i]}
              {i === cursorLine && <span className="typing-cursor" />}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
