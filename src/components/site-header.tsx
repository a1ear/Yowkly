import Link from 'next/link';
import { Logo } from './icons';
import { HeaderAccount } from './header-account';
import { HeaderSearch } from './header-search';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-canvas/80">
      <div className="relative mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-4 md:h-[72px] md:gap-8 md:px-10 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <Link href="/" aria-label="Yowkly home" className="logo-link inline-flex shrink-0 items-center gap-[9px] text-ink hover:text-ink">
          <Logo />
          <span className="font-display text-[26px] leading-none tracking-[-0.01em] md:text-[28px]">Yowkly</span>
        </Link>

        <nav aria-label="Primary" className="hidden justify-center gap-6 lg:flex">
          {[
            ['/explore', 'Explore'],
            ['/for-you', 'For You'],
            ['/ranking', 'Ranking'],
            ['/community', 'Community'],
            ['/categories', 'Categories'],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="nav-link inline-flex h-11 items-center text-sm font-medium whitespace-nowrap text-ink-2 hover:text-accent-ink">
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4 md:gap-8 lg:justify-self-end">
          <HeaderSearch />
          <HeaderAccount />
        </div>
      </div>
    </header>
  );
}
