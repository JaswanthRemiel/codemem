import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import type { Metadata } from 'next';
import { Geist_Pixel, Inter, JetBrains_Mono } from 'next/font/google';
import { appDescription, appName } from '@/lib/shared';

const inter = Inter({
  subsets: ['latin'],
});
// Bitmap headings, set against halftone imagery.
const pixel = Geist_Pixel({
  subsets: ['latin'],
  variable: '--font-pixel',
  // Next has no fallback metrics for this face; without this it warns on every build.
  adjustFontFallback: false,
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
      className={`${inter.className} ${pixel.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        {/* Dark only: there is no light mode. */}
        <RootProvider theme={{ forcedTheme: 'dark', defaultTheme: 'dark', enableSystem: false }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
