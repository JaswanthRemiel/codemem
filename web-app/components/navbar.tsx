import Link from 'next/link';
import { SearchTrigger } from 'fumadocs-ui/layouts/shared/slots/search-trigger';
import { githubUrl, npmUrl } from '@/lib/shared';

const link = 'px-3 py-2 text-sm text-white/80 transition-colors hover:text-white';

/** The landing page's navigation: full width on the brand blue, ruled like the hero below it. */
export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/20 bg-[var(--brand-blue)] text-white">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1 border-x border-white/20 px-3 sm:px-4">
        <Link
          href="/"
          aria-label="remimem home"
          className="press mr-2 flex items-center gap-2 py-1 font-display text-xl"
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center bg-white text-sm text-[var(--brand-blue)]"
          >
            μ
          </span>
          remimem
        </Link>
        <Link href="/docs" className={`${link} hidden sm:block`}>
          Docs
        </Link>
        <Link href="/docs/benchmark" className={`${link} hidden md:block`}>
          Benchmark
        </Link>
        <Link href="/docs/changelog" className={`${link} hidden md:block`}>
          Changelog
        </Link>
        <a href={npmUrl} className={`${link} hidden lg:block`}>
          npm
        </a>
        <span className="flex-1" />
        {/* The site's search, recolored for the blue bar. */}
        <SearchTrigger className="text-white/80 hover:bg-white/10 hover:text-white" />
        <a
          href={githubUrl}
          aria-label="GitHub"
          className="press grid size-9 place-items-center text-white/80 transition-colors hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
            <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
          </svg>
        </a>
        {/* The one call to action, as in a printed masthead: a white block in mono. */}
        <Link
          href="/docs/quickstart"
          className="press ml-1 bg-white px-4 py-2 font-mono text-xs text-[#0b0c1e] transition-colors hover:bg-white/90"
        >
          Get started
        </Link>
      </nav>
    </header>
  );
}
