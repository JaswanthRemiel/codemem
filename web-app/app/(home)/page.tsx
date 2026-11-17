import Link from 'next/link';
import { gitConfig, githubUrl } from '@/lib/shared';

const demoGif = `https://raw.githubusercontent.com/${gitConfig.user}/${gitConfig.repo}/${gitConfig.branch}/docs/demo.gif`;

const stats = [
  { value: '86%', label: 'fewer tokens per task than grep and read' },
  { value: '0.93', label: 'recall@10 on held-out tasks (target 0.80)' },
  { value: '38s', label: 'to index a 99k-line repo on a laptop' },
  { value: '35 ms', label: 'p95 query latency, warm index' },
];

const features = [
  {
    title: 'Structure-aware index',
    body: 'tree-sitter parses TypeScript, JavaScript, Python, and Go into functions, methods, classes, and types. Every other text file is searchable in line windows.',
  },
  {
    title: 'Hybrid search',
    body: 'An identifier-aware keyword index, a local embedding model, and exact symbol lookup, fused by rank. Each result says why it was returned.',
  },
  {
    title: 'Call graph',
    body: 'Callers, callees, base classes, and referenced types of the top results come along as signatures, with a confidence on every link.',
  },
  {
    title: 'Token budgets',
    body: 'Answers fit the budget you give, grouped by file with path:start-end headers, and say exactly what was dropped. They never go over.',
  },
  {
    title: 'Project memory',
    body: 'Decisions, conventions, and gotchas linked to code, shared through a committed JSON file, and flagged stale when the code changes.',
  },
  {
    title: 'Local first',
    body: 'Parsing, embedding, and storage happen on your machine in one SQLite file. No telemetry. Remote embeddings only if you ask for them.',
  },
];

const clients = ['Claude Code', 'Cursor', 'VS Code Copilot', 'any MCP client'];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 pt-16 pb-12 text-center md:pt-24">
        <p className="mb-4 rounded-full border px-3 py-1 text-xs text-fd-muted-foreground">
          Open source, MIT licensed, version 0.1.0
        </p>
        <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
          Codebase memory for <span className="text-fd-primary">coding agents</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-fd-muted-foreground">
          remimem indexes your codebase and gives Claude Code, Cursor, VS Code, or any MCP client
          the smallest set of code that answers the question, within a token budget, plus the
          decisions your team already made.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/docs/quickstart"
            className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground hover:opacity-90"
          >
            Get started
          </Link>
          <a
            href={githubUrl}
            className="rounded-lg border px-5 py-2.5 text-sm font-medium hover:bg-fd-accent"
          >
            View on GitHub
          </a>
        </div>
        <code className="mt-6 rounded-lg border bg-fd-card px-4 py-2 font-mono text-sm">
          npx -y remimem init
        </code>
        <p className="mt-3 text-xs text-fd-muted-foreground">Works with {clients.join(', ')}.</p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- an animated GIF served from GitHub */}
        <img
          src={demoGif}
          alt="remimem indexing a project, answering a question within a token budget, saving a memory, and showing its stats"
          className="w-full rounded-xl border shadow-lg"
          width={1200}
          height={720}
        />
      </section>

      <section className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-4 px-4 py-16 md:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-fd-card p-5">
            <div className="text-3xl font-bold text-fd-primary">{stat.value}</div>
            <div className="mt-2 text-sm text-fd-muted-foreground">{stat.label}</div>
          </div>
        ))}
        <p className="col-span-full text-xs text-fd-muted-foreground">
          From the reproducible benchmark: 36 held-out tasks taken from real commits in hono,
          httpx, and echo, measured on an Apple M5.{' '}
          <Link href="/docs/benchmark" className="underline">
            Method, full results, and what the numbers do not show
          </Link>
          .
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-16">
        <h2 className="text-2xl font-semibold">What it does</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-xl border bg-fd-card p-5">
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-fd-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-24">
        <div className="rounded-xl border bg-fd-card p-6 md:p-10">
          <h2 className="text-2xl font-semibold">Two commands to connect an agent</h2>
          <pre className="mt-6 overflow-x-auto rounded-lg border bg-fd-background p-4 text-left font-mono text-sm">
            {`# in your project
npx -y remimem init

# Claude Code
claude mcp add remimem -- npx -y remimem serve`}
          </pre>
          <p className="mt-4 text-sm text-fd-muted-foreground">
            Setup for Cursor, VS Code, and other clients is in the{' '}
            <Link href="/docs/clients" className="underline">
              client guides
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
