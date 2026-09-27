import Link from 'next/link';
import { Icon, Logo } from './icons';
import { HeaderAccount, SearchShortcut } from './header-account';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-canvas/80">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-4 md:h-[72px] md:gap-8 md:px-10">
        <Link href="/" aria-label="Yowkly home" className="inline-flex items-center gap-[9px] text-ink hover:text-ink">
          <Logo />
          <span className="font-display text-[26px] leading-none tracking-[-0.01em] md:text-[28px]">Yowkly</span>
        </Link>

        <nav aria-label="Primary" className="hidden gap-6 lg:flex">
          {[
            ['/explore', 'Explore'],
            ['/for-you', 'For You'],
            ['/awards', 'Awards'],
            ['/categories', 'Categories'],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="inline-flex h-11 items-center text-sm font-medium whitespace-nowrap text-ink-2 hover:text-accent-ink">
              {label}
            </Link>
          ))}
        </nav>

        <form action="/explore" role="search" className="ml-auto hidden max-w-[460px] flex-1 md:flex">
          <label className="flex h-11 w-full items-center gap-2.5 rounded-md bg-surface-1 pr-3 pl-3.5 text-ink-3 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_2px_var(--accent)]">
            <Icon name="search" size={17} />
            <span className="sr-only">Search templates</span>
            <input
              id="site-search"
              type="search"
              name="q"
              placeholder="Search templates, creators, stacks"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
            />
            <kbd className="rounded-[5px] px-1.5 py-[3px] font-mono text-[11px] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">⌘K</kbd>
          </label>
          <SearchShortcut />
        </form>

        <Link href="/explore" aria-label="Search" className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-md md:hidden">
          <Icon name="search" size={20} />
        </Link>
        <HeaderAccount />
      </div>
    </header>
  );
}
