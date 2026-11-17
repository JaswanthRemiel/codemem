'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

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

/** The hero's setup snippet: one tab per client, with a copy button. */
export function SetupPanel() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const tab = tabs[active] ?? tabs[0];

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

  return (
    <div className="w-full overflow-hidden rounded-xl border bg-fd-card text-left shadow-sm">
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
          className="rounded-md p-2 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6">
        {tab.lines.map((line, i) => (
          <div key={i} className="flex">
            <span className="mr-4 w-4 shrink-0 select-none text-right text-fd-muted-foreground/50">
              {i + 1}
            </span>
            <span className={line.startsWith('#') ? 'text-fd-muted-foreground' : ''}>{line}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
