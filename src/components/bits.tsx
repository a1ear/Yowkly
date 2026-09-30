import Link from 'next/link';
import { Icon } from './icons';
import { formatCount, hash, initials } from '@/lib/format';
import { awardLabel, LICENSE_SHORT, mediaUrl } from '@/lib/labels';
import type { Award } from '@/lib/types';

const AVATAR_FILLS = ['#E8B89A', '#A8C5E8', '#C9E8A8', '#E8D8A8', '#D7B8E8', '#A8E8D8'];

export function Avatar({ name, path, size = 20, seed }: { name: string; path?: string | null; size?: number; seed?: string }) {
  if (path) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={mediaUrl(path, 'avatars')} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-[-0.02em] text-[#1A1712]"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.38)), background: AVATAR_FILLS[hash(seed ?? name) % AVATAR_FILLS.length] }}
    >
      {initials(name)}
    </span>
  );
}

export function AwardRibbon({ award, small = false }: { award: Award; small?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[4px_4px_4px_0] bg-accent py-1.5 pr-[9px] pl-[7px] font-mono font-medium tracking-[0.02em] text-on-accent uppercase leading-none shadow-[0_6px_16px_rgba(0,0,0,.35)] ${small ? 'text-[10.5px]' : 'text-xs'}`}>
      <Icon name="award" size={13} strokeWidth={2} />
      {awardLabel(award)}
    </span>
  );
}

export function LicensePill({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line py-1 pr-2 pl-1.5 text-[11px] leading-none font-medium text-ink-2">
      <Icon name="shield" size={11} strokeWidth={2} />
      {LICENSE_SHORT[code] ?? code}
    </span>
  );
}

/** Votes (paid in yowkbits, drive the Ranking) are shown apart from likes (free). */
export function Stats({ votes, likes, downloads, size = 'sm' }: { votes: number; likes: number; downloads: number | null; size?: 'sm' | 'md' }) {
  return (
    <div className={`flex items-center gap-3 font-mono text-ink-3 ${size === 'md' ? 'text-[13px]' : 'text-xs'}`}>
      <span className={`inline-flex items-center gap-1 ${votes > 0 ? 'text-accent-ink' : ''}`} aria-label={`${formatCount(votes)} vote${votes === 1 ? '' : 's'}`}>
        <Icon name="bit" size={12} strokeWidth={2} />{formatCount(votes)}
      </span>
      <span className="inline-flex items-center gap-1" aria-label={`${formatCount(likes)} like${likes === 1 ? '' : 's'}`}><Icon name="heart" size={12} strokeWidth={2} />{formatCount(likes)}</span>
      {downloads !== null && <span className="inline-flex items-center gap-1" aria-label={`${formatCount(downloads)} download${downloads === 1 ? '' : 's'}`}><Icon name="download" size={12} strokeWidth={2} />{formatCount(downloads)}</span>}
    </div>
  );
}

export function SectionHeader({ title, href, linkLabel = 'See all', as: As = 'h2' }: { title: string; href?: string; linkLabel?: string; as?: 'h1' | 'h2' }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <As className="m-0 font-display text-[26px] leading-[1.1] font-normal tracking-[-0.01em] md:text-[30px]">{title}</As>
      {href && (
        <Link href={href} className="inline-flex h-11 items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-accent-ink">
          {linkLabel}
          <Icon name="chevronRight" size={16} />
        </Link>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
      <p className="m-0 font-display text-2xl">{title}</p>
      {body && <p className="m-0 max-w-md text-ink-2">{body}</p>}
      {action}
    </div>
  );
}
