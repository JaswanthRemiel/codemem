import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import type { Metadata } from 'next';
import { Cormorant_Garamond, Inter, JetBrains_Mono } from 'next/font/google';
import { appDescription, appName } from '@/lib/shared';

const inter = Inter({
  subsets: ['latin'],
});
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
});
const jetbrains = JetBrains_Mono({
  // Greek for the ΜΝΗΜΟΣΥΝΗ label on the landing page.
  subsets: ['latin', 'greek'],
  variable: '--font-jetbrains',
});

export const metadata: Metadata = {
  // Set NEXT_PUBLIC_SITE_URL when deploying so social preview images get absolute URLs.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: `${appName}: codebase memory for coding agents`, template: `%s | ${appName}` },
  description: appDescription,
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${inter.className} ${cormorant.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
