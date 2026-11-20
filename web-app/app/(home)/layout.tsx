import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Navbar } from '@/components/navbar';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  const options = baseOptions();
  return (
    <div className="flex flex-1 flex-col">
      {/* The landing page draws its own navbar, on the brand blue like the hero. */}
      <HomeLayout {...options} nav={{ ...options.nav, enabled: false }}>
        <Navbar />
        {children}
      </HomeLayout>
    </div>
  );
}
