import Link from 'next/link';
import { SearchTrigger } from 'fumadocs-ui/layouts/shared/slots/search-trigger';
import { ThemeSwitch } from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import { githubUrl, npmUrl } from '@/lib/shared';

const link =
  'rounded-full px-3 py-1.5 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground';

/** A small floating navigation pill for the landing page. */
export function Dock() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-4">
      <nav className="pointer-events-auto flex max-w-full items-center gap-0.5 rounded-full border border-fd-border bg-fd-background/75 p-1 shadow-lg shadow-black/5 backdrop-blur-md">
        <Link
          href="/"
          aria-label="remimem home"
          className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1.5 font-serif text-lg font-semibold"
        >
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-full border border-fd-primary text-sm text-fd-primary"
          >
            μ
          </span>
          <span className="hidden sm:inline">remimem</span>
        </Link>
        <span aria-hidden className="mx-1 h-5 w-px bg-fd-border" />
        <Link href="/docs" className={link}>
          Docs
        </Link>
        <Link href="/docs/benchmark" className={link}>
          Benchmark
        </Link>
        <a href={npmUrl} className={`${link} hidden sm:inline`}>
          npm
        </a>
        <span aria-hidden className="mx-1 h-5 w-px bg-fd-border" />
        <SearchTrigger className="rounded-full" />
        <ThemeSwitch className="hidden sm:flex" />
        <a
          href={githubUrl}
          aria-label="GitHub"
          className="grid size-8 place-items-center rounded-full text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
            <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
          </svg>
        </a>
      </nav>
    </header>
  );
}
