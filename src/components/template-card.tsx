import Link from 'next/link';
import { Cover } from './cover';
import { Avatar, AwardRibbon, LicensePill, Stats } from './bits';
import { Icon } from './icons';
import { displayTools } from '@/lib/labels';
import type { TemplateCard as Card } from '@/lib/types';

const STACK_TYPES = new Set(['stack']);

/** Grid card. The whole card is one link target; the title link carries the name. */
export function TemplateCard({ t, priority = false, tall = false }: { t: Card; priority?: boolean; tall?: boolean }) {
  const tools = displayTools(t.tools);
  const stacks = t.tags.filter((g) => STACK_TYPES.has(g.type)).slice(0, 2);
  return (
    <article className="group relative flex min-w-0 flex-col gap-3">
      <div className={`card-hover relative overflow-hidden rounded-lg bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)] ${tall ? 'aspect-[9/14]' : 'aspect-[16/10]'}`}>
        <Cover seed={t.slug} title={t.title} coverPath={t.cover_path} kind={t.category_kind} priority={priority} tall={tall} />
        {t.award && (
          <div className="absolute top-2.5 left-2.5">
            <AwardRibbon award={t.award} small />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Link
          href={`/t/${t.slug}`}
          className="truncate text-[15px] leading-[1.3] font-semibold tracking-[-0.01em] after:absolute after:inset-0 after:content-[''] group-hover:text-accent-ink"
        >
          {t.title}
        </Link>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-[7px] text-[13px] text-ink-2">
            <Avatar name={t.owner_display_name} path={t.owner_avatar_path} seed={t.owner_username} />
            <span className="truncate">{t.owner_display_name}</span>
          </span>
          <Stats score={t.score} votes={t.vote_count} likes={t.like_count} downloads={t.download_count} />
        </div>
        <div className="flex flex-wrap items-center gap-[5px]">
          {tools.map((tool) => <span key={tool} className="chip-tool">{tool}</span>)}
          {stacks.map((s) => <span key={s.slug} className="chip-stack">{s.name}</span>)}
          <LicensePill code={t.license_code} />
        </div>
      </div>
    </article>
  );
}

export function TemplateRow({ t }: { t: Card }) {
  return (
    <article className="relative flex items-center gap-4 rounded-lg p-2 hover:bg-surface-1">
      <div className="aspect-[16/10] w-28 shrink-0 overflow-hidden rounded-md bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
        <Cover seed={t.slug} title={t.title} coverPath={t.cover_path} kind={t.category_kind} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link href={`/t/${t.slug}`} className="truncate font-semibold after:absolute after:inset-0 after:content-['']">{t.title}</Link>
        <span className="truncate text-[13px] text-ink-2">
          {t.owner_display_name} · {displayTools(t.tools).join(', ') || t.category_name}
        </span>
      </div>
      <Stats score={t.score} votes={t.vote_count} likes={t.like_count} downloads={t.download_count} />
      <Icon name="chevronRight" size={16} className="text-ink-3" />
    </article>
  );
}

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading templates">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="skeleton aspect-[16/10] rounded-lg" />
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
