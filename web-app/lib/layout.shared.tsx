import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, githubUrl, npmUrl } from './shared';

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-display text-xl tracking-tight">
      <span
        aria-hidden
        className="grid size-6 place-items-center rounded-sm bg-fd-primary text-sm text-fd-primary-foreground"
      >
        μ
      </span>
      {appName}
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Logo /> },
    githubUrl,
    // Dark only, so there is nothing to switch.
    themeSwitch: { enabled: false },
    links: [
      { text: 'Documentation', url: '/docs', active: 'nested-url' },
      { text: 'Benchmark', url: '/docs/benchmark' },
      { text: 'npm', url: npmUrl, external: true },
    ],
  };
}
