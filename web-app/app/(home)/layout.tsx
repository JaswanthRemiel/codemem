import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Dock } from '@/components/dock';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  const options = baseOptions();
  return (
    <div className="grain flex flex-1 flex-col">
      {/* The landing page uses the floating dock instead of the full-width navbar. */}
      <HomeLayout {...options} nav={{ ...options.nav, enabled: false }}>
        <Dock />
        {children}
      </HomeLayout>
    </div>
  );
}
