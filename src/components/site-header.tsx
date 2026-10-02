import Link from 'next/link';
import { Logo } from './icons';
import { HeaderAccount } from './header-account';
import { HeaderSearch } from './header-search';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-canvas/80">
      <div className="relative mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 md:h-16 md:gap-6 md:px-8 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <Link href="/" aria-label="Yowkly home" className="logo-link inline-flex shrink-0 items-center gap-[9px] text-ink hover:text-ink">
          <Logo />
          <span className="font-display text-[24px] leading-none tracking-[-0.01em] md:text-[26px]">Yowkly</span>
        </Link>

        <nav aria-label="Primary" className="hidden justify-center gap-5 lg:flex">
          {[
            ['/explore', 'Explore'],
            ['/for-you', 'For You'],
            ['/ranking', 'Ranking'],
            ['/community', 'Community'],
            ['/categories', 'Categories'],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="nav-link inline-flex h-10 items-center text-[13.5px] font-medium whitespace-nowrap text-ink-2 hover:text-accent-ink">
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 md:gap-2 lg:justify-self-end">
          <HeaderSearch />
          <HeaderAccount />
        </div>
      </div>
    </header>
  );
}
