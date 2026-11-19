import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { amphora, COLUMN, SYSTEM_MONO, TEMPLE } from '@/components/ascii';
import { AsciiField } from '@/components/ascii-field';
import { CountUp, Reveal } from '@/components/motion';
import { SetupPanel } from '@/components/setup-panel';
import { TerminalDemo } from '@/components/terminal-demo';
import { githubUrl, npmUrl } from '@/lib/shared';

const pillars = [
  {
    numeral: 'I',
    greek: 'Mneme',
    title: 'Index',
    body: 'Every function, class, and call in your codebase, parsed and mapped on your own machine.',
  },
  {
    numeral: 'II',
    greek: 'Anamnesis',
    title: 'Recall',
    body: 'The code that answers the question, found by name, by meaning, and through the call graph.',
  },
  {
    numeral: 'III',
    greek: 'Mnemosyne',
    title: 'Remember',
    body: 'The decisions your team made, linked to code, kept across sessions, flagged when code changes.',
  },
];

const numbers = [
  { value: '86%', label: 'fewer tokens per task than grep and read' },
  { value: '0.93', label: 'recall@10 on held-out tasks' },
  { value: '35 ms', label: 'p95 query latency' },
  { value: '38 s', label: 'to index 99,000 lines' },
];

// Mnemosyne had nine daughters, the Muses; remimem has nine tools.
const muses = [
  ['Calliope', 'get_context', 'The best starting context for a task, memory included.'],
  ['Clio', 'search_code', 'Ranked code for a query, with the reason for each result.'],
  ['Erato', 'get_symbol', 'One function or class, with its callers and callees.'],
  ['Euterpe', 'get_file_outline', 'What a file contains, without reading it.'],
  ['Melpomene', 'find_references', 'Every caller and importer, before you change a symbol.'],
  ['Polyhymnia', 'remember', 'Keep a decision or convention, linked to code.'],
  ['Terpsichore', 'recall', 'Search what the project already decided.'],
  ['Thalia', 'forget', 'Let go of a memory that is no longer true.'],
  ['Urania', 'index_status', 'What the index covers, and what changed.'],
];

const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] tracking-[0.25em] text-fd-primary uppercase">{children}</p>
  );
}

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <AsciiField className="ascii-field absolute inset-0 size-full text-fd-primary" />
        <div className="relative mx-auto flex min-h-[86svh] w-full max-w-4xl flex-col items-center justify-center px-5 pt-28 pb-16 text-center sm:px-6">
          <div style={{ animationDelay: '0ms' }} className="enter">
            <span className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-background/70 px-3.5 py-1.5 font-mono text-[10px] tracking-[0.22em] text-fd-primary uppercase backdrop-blur sm:text-[11px]">
              ΜΝΗΜΟΣΥΝΗ <span className="text-fd-muted-foreground">/</span> memory for machines
            </span>
          </div>
          <h1
            style={{ animationDelay: '90ms' }}
            className="enter mt-7 font-serif text-[2.75rem] leading-[1.02] font-semibold tracking-tight text-balance sm:text-6xl md:text-7xl lg:text-8xl"
          >
            Your agents forget.
            <br />
            <em className="font-medium text-fd-primary">remimem remembers.</em>
          </h1>
          <p
            style={{ animationDelay: '180ms' }}
            className="enter mt-6 max-w-xl text-base leading-relaxed text-pretty text-fd-muted-foreground sm:text-lg"
          >
            Poets called on Mnemosyne, goddess of memory, before they began. remimem gives your
            coding agent the same: the right code within a token budget, and every decision your
            team already made.
          </p>
          <div
            style={{ animationDelay: '270ms' }}
            className="enter mt-9 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center"
          >
            <Link
              href="/docs/quickstart"
              className="group inline-flex items-center justify-center gap-2 rounded-sm bg-fd-foreground px-5 py-3 text-sm font-medium text-fd-background transition-opacity hover:opacity-85"
            >
              Get started
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <code className="rounded-sm border border-fd-border bg-fd-background/80 px-4 py-3 text-center font-mono text-sm backdrop-blur">
              npx -y remimem init
            </code>
          </div>
          <p
            style={{ animationDelay: '340ms' }}
            className="enter mt-5 text-xs text-fd-muted-foreground"
          >
            Open source. Runs on your machine. Works with Claude Code, Cursor, VS Code, and any MCP
            client.
          </p>
        </div>
      </section>

      {/* The replay of a first run, just below the hero. */}
      <section className="relative mx-auto -mt-4 w-full max-w-3xl px-4 pb-24 sm:px-6">
        <div style={{ animationDelay: '420ms' }} className="enter">
          <TerminalDemo />
        </div>
      </section>

      <div aria-hidden className="meander" />

      {/* The myth */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-24 lg:grid-cols-2 [&>*]:min-w-0">
        <Reveal>
          <pre
            aria-hidden
            className="ascii-gleam overflow-x-auto font-mono text-[10px] leading-[1.3] sm:text-xs"
          >
            {TEMPLE}
          </pre>
        </Reveal>
        <Reveal delay={120}>
          <Eyebrow>The problem</Eyebrow>
          <h2 className="mt-4 font-serif text-4xl font-semibold tracking-tight md:text-5xl">
            Every session starts with amnesia.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-fd-muted-foreground">
            Agents grep, open whole files, and fill their context with code that has nothing to do
            with the task. Then the session ends and they forget what was decided.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-fd-muted-foreground">
            remimem builds a temple of your codebase instead: every function indexed, every call
            mapped, every decision kept, in one local file.
          </p>
        </Reveal>
      </section>

      {/* Three pillars */}
      <section className="border-y border-fd-border bg-fd-card/60">
        <div className="mx-auto w-full max-w-6xl px-6 py-24">
          <Reveal>
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-4 max-w-2xl font-serif text-4xl font-semibold tracking-tight md:text-5xl">
              Three pillars hold it up.
            </h2>
          </Reveal>
          <div className="mt-16 grid gap-12 md:grid-cols-3">
            {pillars.map((pillar, i) => (
              <Reveal key={pillar.title} delay={i * 140} className="flex gap-5">
                <pre
                  aria-hidden
                  className="shrink-0 font-mono text-[11px] leading-[1.3] text-fd-primary/70"
                >
                  {COLUMN}
                </pre>
                <div>
                  <div className="font-serif text-sm text-fd-muted-foreground italic">
                    {pillar.numeral}. {pillar.greek}
                  </div>
                  <h3 className="mt-1 font-serif text-3xl font-semibold">{pillar.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                    {pillar.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section className="mx-auto w-full max-w-6xl px-6 py-24">
        <Reveal>
          <Eyebrow>Benchmark</Eyebrow>
          <h2 className="mt-4 font-serif text-4xl font-semibold tracking-tight md:text-5xl">
            Measured, not mythologized.
          </h2>
        </Reveal>
        <div className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-fd-border bg-fd-border md:grid-cols-4">
          {numbers.map((n) => (
            <div key={n.label} className="bg-fd-background p-7">
              <div className="font-serif text-5xl font-semibold tracking-tight md:text-6xl">
                <CountUp value={n.value} />
              </div>
              <div className="mt-3 text-sm text-fd-muted-foreground">{n.label}</div>
            </div>
          ))}
        </div>
        <Reveal className="mt-6 flex flex-col justify-between gap-3 text-sm text-fd-muted-foreground md:flex-row">
          <span>
            36 held-out tasks from real commits in hono, httpx, and echo. Rerun it yourself with one
            command.
          </span>
          <Link
            href="/docs/benchmark"
            className="inline-flex items-center gap-1.5 font-medium text-fd-foreground hover:underline"
          >
            Method, every table, and what the numbers do not show <ArrowRight className="size-4" />
          </Link>
        </Reveal>
      </section>

      {/* Nine Muses */}
      <section className="border-y border-fd-border bg-fd-card/60">
        <div className="mx-auto w-full max-w-6xl px-6 py-24">
          <Reveal>
            <Eyebrow>The tools</Eyebrow>
            <h2 className="mt-4 max-w-3xl font-serif text-4xl font-semibold tracking-tight md:text-5xl">
              Mnemosyne had nine daughters. remimem has nine tools.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-px overflow-hidden rounded-sm border border-fd-border bg-fd-border sm:grid-cols-2 lg:grid-cols-3">
            {muses.map(([muse, tool, body], i) => (
              <Reveal
                key={tool}
                delay={(i % 3) * 90}
                className="group bg-fd-background p-6 transition-colors hover:bg-fd-card"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-serif text-sm text-fd-muted-foreground italic">
                    {roman[i]}. {muse}
                  </span>
                </div>
                <div className="mt-3 font-mono text-base text-fd-primary">{tool}</div>
                <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{body}</p>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-6 text-sm">
            <Link
              href="/docs/reference/mcp-tools"
              className="inline-flex items-center gap-1.5 font-medium hover:underline"
            >
              The full tool reference <ArrowRight className="size-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* Connect */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-24 lg:grid-cols-2 [&>*]:min-w-0">
        <Reveal>
          <Eyebrow>Begin</Eyebrow>
          <h2 className="mt-4 font-serif text-4xl font-semibold tracking-tight md:text-5xl">
            Two commands to invoke her.
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-fd-muted-foreground">
            Index the project, connect your agent, and ask. Everything stays on your machine, in one
            SQLite file. No account, no telemetry.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <SetupPanel />
        </Reveal>
      </section>

      {/* Closing */}
      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-28 text-center">
        <Reveal>
          <pre
            aria-hidden
            style={{ fontFamily: SYSTEM_MONO }}
            className="ascii-gleam text-sm leading-[1.25]"
          >
            {amphora(1).join('\n')}
          </pre>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 font-serif text-5xl font-semibold tracking-tight">
            Give your agent a <em className="text-fd-primary">memory</em>.
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <code className="rounded-sm border border-fd-border bg-fd-card px-4 py-3 font-mono text-sm">
              npx -y remimem init
            </code>
            <Link
              href="/docs/quickstart"
              className="group inline-flex items-center gap-2 rounded-sm bg-fd-foreground px-5 py-3 text-sm font-medium text-fd-background transition-opacity hover:opacity-85"
            >
              Read the quickstart
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <div aria-hidden className="meander" />
      <footer>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 text-sm text-fd-muted-foreground md:flex-row md:items-center md:justify-between">
          <span className="font-serif text-base">
            remimem <span className="italic">is memory, kept.</span> MIT licensed.
          </span>
          <nav className="flex flex-wrap gap-6">
            <Link href="/docs" className="hover:text-fd-foreground">
              Docs
            </Link>
            <Link href="/docs/benchmark" className="hover:text-fd-foreground">
              Benchmark
            </Link>
            <Link href="/docs/privacy" className="hover:text-fd-foreground">
              Privacy
            </Link>
            <a href={githubUrl} className="hover:text-fd-foreground">
              GitHub
            </a>
            <a href={npmUrl} className="hover:text-fd-foreground">
              npm
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
