'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './icons';

const TABS: [string, string, IconName][] = [
  ['/', 'Home', 'home'],
  ['/explore', 'Explore', 'compass'],
  ['/upload', 'Upload', 'plus'],
  ['/for-you', 'For You', 'sparkle'],
  ['/me', 'Profile', 'user'],
];

/** Bottom tab bar on phones (design: Home · Explore · Upload · For You · Profile). */
export function MobileTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="m-0 grid list-none grid-cols-5 p-0">
        {TABS.map(([href, label, icon]) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          if (href === '/upload') {
            return (
              <li key={href} className="flex items-center justify-center">
                <Link href={href} aria-label="Upload" className="inline-flex h-11 w-14 items-center justify-center rounded-xl bg-accent text-on-accent">
                  <Icon name="plus" size={22} strokeWidth={2.2} />
                </Link>
              </li>
            );
          }
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? 'text-ink' : 'text-ink-3'}`}
              >
                <Icon name={icon} size={20} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
