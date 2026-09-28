import Link from 'next/link';
import { Logo } from './icons';

const COLUMNS: [string, [string, string][]][] = [
  ['Categories', [
    ['/c/websites', 'Websites'], ['/c/mobile-apps', 'Mobile Apps'], ['/c/ui-kits', 'UI Kits'],
    ['/c/components', 'Components'], ['/c/presentations', 'Presentations'], ['/c/concepts', 'Concepts'],
  ]],
  ['Yowkly', [['/ranking', 'Ranking'], ['/legal/licenses', 'Licenses explained'], ['/legal/upload-guidelines', 'Upload guidelines']]],
  ['Legal', [['/legal/terms', 'Terms'], ['/legal/privacy', 'Privacy'], ['/legal/dmca', 'DMCA']]],
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line pb-24 md:pb-0">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)] md:px-10">
        <div className="flex flex-col gap-3">
          <Link href="/" aria-label="Yowkly home" className="inline-flex items-center gap-[9px]">
            <Logo />
            <span className="font-display text-[26px] leading-none">Yowkly</span>
          </Link>
          <p className="m-0 text-ink-2">For Devs by Devs.</p>
          <p className="m-0 text-[13px] text-ink-3">© {new Date().getFullYear()} Yowkly · by NightPatch</p>
        </div>
        {COLUMNS.map(([title, links]) => (
          <nav key={title} aria-label={title} className="flex flex-col gap-1">
            <h2 className="eyebrow m-0 mb-2">{title}</h2>
            {links.map(([href, label]) => (
              <Link key={href} href={href} className="inline-flex min-h-8 items-center text-ink-2 hover:text-accent-ink">{label}</Link>
            ))}
          </nav>
        ))}
      </div>
    </footer>
  );
}
