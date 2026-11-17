import { ArrowRight, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { CountUp, Reveal } from '@/components/motion';
import { SetupPanel } from '@/components/setup-panel';
import { githubUrl, npmUrl } from '@/lib/shared';

const steps = [
  {
    title: 'Index',
    body: 'Parses your code into functions, classes, and the calls between them. Locally, in seconds.',
  },
  {
    title: 'Retrieve',
    body: 'Finds the code that answers the question by name, by meaning, and through the call graph.',
  },
  {
    title: 'Remember',
    body: 'Keeps the decisions your team made, linked to code, and flags them when the code changes.',
  },
];

const stats = [
  { value: '0.93', label: 'recall@10 on held-out tasks' },
  { value: '35 ms', label: 'p95 query latency' },
  { value: '38 s', label: 'to index 99k lines' },
];

const pillars = [
  {
    title: 'Local',
    body: 'Parsing, embedding, and storage run on your machine, in one SQLite file. No telemetry.',
  },
  {
    title: 'Budgeted',
    body: 'Every answer fits the token budget you set and says exactly what it left out.',
  },
  {
    title: 'Open',
    body: 'MIT licensed. Every number on this page comes from a benchmark you can rerun.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="hero-grid" />
        <div aria-hidden className="hero-glow" />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pt-20 pb-24 md:pt-28 lg:grid-cols-2">
          <div>
            <a
              href={npmUrl}
              style={{ animationDelay: '0ms' }}
              className="enter mb-6 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-fd-muted-foreground transition-colors hover:text-fd-foreground"
            >
              v0.1.0 is out <ArrowUpRight className="size-3" />
            </a>
            <h1
              style={{ animationDelay: '80ms' }}
              className="enter text-4xl font-semibold tracking-tight text-balance md:text-5xl"
            >
              Codebase memory for coding agents.
            </h1>
            <p
              style={{ animationDelay: '160ms' }}
              className="enter mt-5 max-w-md text-lg text-fd-muted-foreground"
            >
              Your agent gets only the code it needs, within a token budget. Open source and local
              first.
            </p>
            <div style={{ animationDelay: '240ms' }} className="enter mt-8 flex items-center gap-5">
              <Link
                href="/docs/quickstart"
                className="group inline-flex items-center gap-2 rounded-lg bg-fd-foreground px-5 py-2.5 text-sm font-medium text-fd-background transition-opacity hover:opacity-85"
              >
                Get started{' '}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href={githubUrl}
                className="text-sm font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                GitHub
              </a>
            </div>
          </div>
          <div style={{ animationDelay: '320ms' }} className="enter">
            <SetupPanel />
          </div>
        </div>
      </section>

      {/* One number */}
      <section className="border-y">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 text-center">
          <div className="text-6xl font-semibold tracking-tight md:text-7xl">
            <CountUp value="86%" />
          </div>
          <p className="mx-auto mt-4 max-w-md text-fd-muted-foreground">
            fewer tokens per task than an agent that greps and reads whole files, on 36 held-out
            tasks from real commits.
          </p>
          <div className="mx-auto mt-12 grid max-w-2xl grid-cols-3 gap-6">
            {stats.map((stat) => (
              <div key={stat.label}>
                <div className="text-2xl font-semibold">
                  <CountUp value={stat.value} duration={1000} />
                </div>
                <div className="mt-1 text-xs text-fd-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-6xl px-6 py-24">
        <Reveal>
          <p className="text-sm text-fd-muted-foreground">How it works</p>
          <h2 className="mt-2 max-w-xl text-3xl font-semibold tracking-tight">
            Index once. Ask anything. Remember what matters.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-10 md:grid-cols-3">
          {steps.map((step, i) => (
            <Reveal key={step.title} delay={i * 120}>
              <div className="text-sm text-fd-muted-foreground">0{i + 1}</div>
              <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{step.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Benchmark callout */}
      <section className="mx-auto w-full max-w-6xl px-6">
        <Reveal>
          <div className="lift flex flex-col items-start justify-between gap-6 rounded-xl bg-fd-muted px-8 py-10 md:flex-row md:items-center">
            <div>
              <span className="rounded-full border bg-fd-background px-2.5 py-0.5 text-xs">
                Benchmark
              </span>
              <h2 className="mt-4 max-w-lg text-xl font-semibold tracking-tight">
                Measured on hono, httpx, and echo. Method, every table, and what the numbers do not
                show.
              </h2>
            </div>
            <Link
              href="/docs/benchmark"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium hover:underline"
            >
              Read the benchmark <ArrowRight className="size-4" />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Pillars */}
      <section className="mx-auto w-full max-w-6xl px-6 py-24">
        <div className="grid gap-10 md:grid-cols-3">
          {pillars.map((pillar, i) => (
            <Reveal key={pillar.title} delay={i * 120} className="border-t pt-6">
              <h3 className="font-semibold">{pillar.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{pillar.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Closing call to action */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24 text-center">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight">Give your agent a memory.</h2>
        </Reveal>
        <code className="mt-6 inline-block rounded-lg border bg-fd-card px-4 py-2 font-mono text-sm">
          npx -y remimem init
        </code>
        <div className="mt-6">
          <Link
            href="/docs/quickstart"
            className="group inline-flex items-center gap-2 rounded-lg bg-fd-foreground px-5 py-2.5 text-sm font-medium text-fd-background transition-opacity hover:opacity-85"
          >
            Read the quickstart <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 text-sm text-fd-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>remimem. MIT licensed.</span>
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
