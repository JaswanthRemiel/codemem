import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { AMPHORA, COLUMN, OWL } from '@/components/pixel-art';
import { PixelSprite } from '@/components/pixel-sprite';
import { Halftone } from '@/components/halftone';
import { CountUp, Reveal } from '@/components/motion';
import { SetupPanel } from '@/components/setup-panel';
import { TerminalDemo } from '@/components/terminal-demo';
import { githubUrl, npmUrl } from '@/lib/shared';

const pillars = [
  {
    numeral: 'I',
    greek: 'Mneme',
    title: 'Index',
    sprite: { frames: COLUMN, fps: 6, label: 'A column raised stone by stone' },
    body: 'Every function, class, and call in your codebase, parsed and mapped on your own machine.',
  },
  {
    numeral: 'II',
    greek: 'Anamnesis',
    title: 'Recall',
    sprite: { frames: OWL, fps: 3, label: 'An owl keeping watch' },
    body: 'The code that answers the question, found by name, by meaning, and through the call graph.',
  },
  {
    numeral: 'III',
    greek: 'Mnemosyne',
    title: 'Remember',
    sprite: { frames: AMPHORA, fps: 5, label: 'An amphora filling up' },
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
      {/* Hero: white type over a halftone temple, on the brand blue. */}
      <section className="relative overflow-hidden bg-[var(--brand-blue)] text-white">
        <Halftone className="absolute inset-0 size-full" />
        {/* Keeps the text calm above the temple on phones and tablets; wider screens thin the dots
            around the text in the canvas itself. */}

        {/* A solid strip under the navbar, between rules, as in a printed masthead. */}
        <div className="relative border-b border-white/20 bg-[var(--brand-blue)]">
          <div className="mx-auto flex w-full max-w-6xl border-x border-white/20 text-sm">
            <Link
              href="/docs/guides/dashboard"
              className="press flex items-center gap-3 px-5 py-3 hover:bg-white/10 sm:px-6 md:border-r md:border-white/20"
            >
              <span className="bg-white px-2 py-0.5 font-mono text-[11px] text-[var(--brand-blue)]">
                New
              </span>
              A local dashboard in 0.2
            </Link>
            <span className="hidden items-center px-6 py-3 text-white/80 md:flex">
              Works with Claude Code, Cursor, VS Code, and any MCP client
            </span>
          </div>
        </div>
        <div aria-hidden className="fade-down absolute inset-x-0 top-0 h-[56%] lg:hidden" />
        <div className="relative mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-6xl flex-col border-x border-white/20 md:min-h-[calc(92svh-3.5rem)]">
          <div className="relative flex flex-1 flex-col justify-start px-5 pt-12 pb-[48svh] sm:px-6 lg:justify-center lg:pt-0 lg:pb-24">
            <p
              style={{ animationDelay: '0ms' }}
              className="enter font-mono text-[11px] tracking-[0.25em] text-white/75 uppercase"
            >
              ΜΝΗΜΟΣΥΝΗ &nbsp;/&nbsp; memory for machines
            </p>
            <h1
              style={{ animationDelay: '90ms' }}
              className="enter mt-6 max-w-2xl font-display text-[2.9rem] leading-[0.95] tracking-tight sm:text-6xl md:text-7xl lg:text-[4.75rem]"
            >
              Your agents forget. remimem remembers.
            </h1>
            <p
              style={{ animationDelay: '180ms' }}
              className="enter mt-6 max-w-md text-base leading-relaxed text-white/85 sm:text-lg"
            >
              Poets called on Mnemosyne, goddess of memory, before they began. remimem gives your
              coding agent the same: the right code within a token budget, and every decision your
              team already made.
            </p>
            <div
              style={{ animationDelay: '270ms' }}
              className="enter mt-8 flex flex-col items-stretch gap-0 font-mono text-sm sm:flex-row sm:items-center"
            >
              <Link
                href="/docs/quickstart"
                className="press group inline-flex items-center justify-center gap-2 bg-white py-3 ps-5 pe-4.5 text-[#0b0c1e] transition-colors hover:bg-white/90"
              >
                Get started
                <ArrowRight
                  strokeWidth={1.5}
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <code className="bg-[#0b0c1e] px-5 py-3 text-center text-white">
                npx -y remimem init
              </code>
            </div>
          </div>
        </div>
      </section>

      {/* Everything below sits in one frame, ruled at the sides like the hero. */}
      <div className="mx-auto w-full max-w-6xl border-x border-fd-border">
        {/* The problem, and the replay of a first run */}
        <section className="px-6 pt-24 pb-6">
          <Reveal className="grid items-end gap-8 lg:grid-cols-2">
            <h2 className="font-display text-4xl leading-[1.02] tracking-tight md:text-6xl">
              Every session starts with amnesia.
            </h2>
            <p className="text-lg leading-relaxed text-fd-muted-foreground">
              Agents grep, open whole files, and fill their context with code that has nothing to do
              with the task. Then the session ends and they forget what was decided. remimem keeps
              every function indexed, every call mapped, and every decision, in one local file.
            </p>
          </Reveal>
          <Reveal delay={120} className="halftone mt-14 px-4 py-10 sm:px-10 sm:py-14">
            <div className="mx-auto max-w-3xl">
              <TerminalDemo />
            </div>
          </Reveal>
        </section>

        {/* Three pillars */}
        <section className="px-6 py-24">
          <Reveal>
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-4 max-w-2xl font-display text-4xl tracking-tight md:text-5xl">
              Three pillars hold it up.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {pillars.map((pillar, i) => (
              <Reveal key={pillar.title} delay={i * 140} className="halftone flex flex-col p-6">
                {/* A fixed slot, so sprites of different heights keep the text below aligned. */}
                <div className="flex h-20 items-end">
                  <PixelSprite {...pillar.sprite} pixel={6} className="text-white/85" />
                </div>
                <div className="mt-8 font-mono text-[11px] tracking-[0.2em] text-white/70 uppercase">
                  {pillar.numeral}. {pillar.greek}
                </div>
                <h3 className="mt-2 font-display text-3xl">{pillar.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-white/85">{pillar.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Numbers */}
        <section className="px-6 py-24">
          <Reveal>
            <Eyebrow>Benchmark</Eyebrow>
            <h2 className="mt-4 font-display text-4xl tracking-tight md:text-5xl">
              Measured, not mythologized.
            </h2>
          </Reveal>
          <div className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-fd-border bg-fd-border md:grid-cols-4">
            {numbers.map((n) => (
              <div key={n.label} className="bg-fd-background p-7">
                <div className="font-display text-5xl tracking-tight text-fd-primary tabular-nums md:text-6xl">
                  <CountUp value={n.value} />
                </div>
                <div className="mt-3 text-sm text-fd-muted-foreground">{n.label}</div>
              </div>
            ))}
          </div>
          <Reveal className="mt-6 flex flex-col justify-between gap-3 text-sm text-fd-muted-foreground md:flex-row">
            <span>
              36 held-out tasks from real commits in hono, httpx, and echo. Rerun it yourself with
              one command.
            </span>
            <Link
              href="/docs/benchmark"
              className="inline-flex items-center gap-1.5 font-medium text-fd-foreground hover:underline"
            >
              Method, every table, and what the numbers do not show{' '}
              <ArrowRight strokeWidth={1.5} className="size-4" />
            </Link>
          </Reveal>
        </section>

        {/* Nine Muses */}
        <section className="border-y border-fd-border bg-fd-card/60">
          <div className="px-6 py-24">
            <Reveal>
              <Eyebrow>The tools</Eyebrow>
              <h2 className="mt-4 max-w-3xl font-display text-4xl tracking-tight md:text-5xl">
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
                    <span className="font-mono text-[11px] tracking-[0.2em] text-fd-muted-foreground uppercase">
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
                The full tool reference <ArrowRight strokeWidth={1.5} className="size-4" />
              </Link>
            </Reveal>
          </div>
        </section>

        {/* Connect */}
        <section className="grid items-center gap-12 px-6 py-24 lg:grid-cols-2 [&>*]:min-w-0">
          <Reveal>
            <Eyebrow>Begin</Eyebrow>
            <h2 className="mt-4 font-display text-4xl tracking-tight md:text-5xl">
              Two commands to invoke her.
            </h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-fd-muted-foreground">
              Index the project, connect your agent, and ask. Everything stays on your machine, in
              one SQLite file. No account, no telemetry.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <SetupPanel />
          </Reveal>
        </section>

        {/* Closing */}
        <section className="flex flex-col items-center px-6 pb-28 text-center">
          <Reveal>
            <PixelSprite frames={AMPHORA} fps={5} pixel={9} className="text-fd-primary" />
          </Reveal>
          <Reveal delay={100}>
            <h2 className="mt-8 font-display text-5xl tracking-tight">
              Give your agent a <span className="text-fd-primary">memory</span>.
            </h2>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <code className="rounded-sm border border-fd-border bg-fd-card px-4 py-3 font-mono text-sm">
                npx -y remimem init
              </code>
              <Link
                href="/docs/quickstart"
                className="press group inline-flex items-center gap-2 rounded-sm bg-fd-foreground py-3 ps-5 pe-4.5 text-sm font-medium text-fd-background transition-opacity hover:opacity-85"
              >
                Read the quickstart
                <ArrowRight
                  strokeWidth={1.5}
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </div>
          </Reveal>
        </section>

        {/* Footer */}
        <div aria-hidden className="meander" />
        <footer>
          <div className="flex flex-col gap-6 px-6 py-10 text-sm text-fd-muted-foreground md:flex-row md:items-center md:justify-between">
            <span className="font-display text-base">
              remimem is memory, kept. <span className="font-sans text-sm">MIT licensed.</span>
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
      </div>
    </main>
  );
}
