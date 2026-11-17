import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, githubUrl, npmUrl } from './shared';

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold">
      <span
        aria-hidden
        className="grid size-6 place-items-center rounded-md bg-fd-primary text-xs font-bold text-fd-primary-foreground"
      >
        r
      </span>
      {appName}
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Logo /> },
    githubUrl,
    links: [
      { text: 'Documentation', url: '/docs', active: 'nested-url' },
      { text: 'Benchmark', url: '/docs/benchmark' },
      { text: 'npm', url: npmUrl, external: true },
    ],
  };
}
