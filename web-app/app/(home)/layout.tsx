import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <div className="home-neutral flex flex-1 flex-col bg-fd-background text-fd-foreground">
      <HomeLayout {...baseOptions()}>{children}</HomeLayout>
    </div>
  );
}
