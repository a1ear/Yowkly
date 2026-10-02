import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { MobileTabs } from '@/components/mobile-tabs';
import { Toaster } from '@/components/toast';
import { CookieNotice } from '@/components/cookie-notice';
import { ChatDock } from '@/components/chat-dock';
import { TooltipLayer } from '@/components/tooltips';
import { Analytics } from '@vercel/analytics/next';
import { publicEnv } from '@/lib/env';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument-serif', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
  title: { default: 'Yowkly — For Devs by Devs', template: '%s · Yowkly' },
  description:
    'Discover, vote on and download web templates, mobile app designs and UI kits from developers and designers. Figma, Photoshop, Canva, Sketch and code.',
  openGraph: { type: 'website', siteName: 'Yowkly' },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#0F0E0C',
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${serif.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent">
          Skip to content
        </a>
        <Toaster>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
          <MobileTabs />
          <CookieNotice />
          <ChatDock />
          <TooltipLayer />
        </Toaster>
        {/* Cookie-free page-view analytics; reports only when deployed on Vercel. */}
        <Analytics />
      </body>
    </html>
  );
}
