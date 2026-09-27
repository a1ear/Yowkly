import Link from 'next/link';
import { getHome } from '@/lib/data/public';
import { Cover } from '@/components/cover';
import { Avatar, AwardRibbon, EmptyState, SectionHeader, Stats } from '@/components/bits';
import { TemplateCard, TemplateRow } from '@/components/template-card';
import { Countdown } from '@/components/countdown';
import { SignupBand } from '@/components/signup-band';
import { Icon } from '@/components/icons';
import { displayTools } from '@/lib/labels';
import { formatCompact } from '@/lib/format';

export const revalidate = 60;

const CHIPS: [string, string][] = [
  ['/explore', 'All'], ['/c/websites', 'Websites'], ['/c/mobile-apps', 'Mobile Apps'], ['/c/ui-kits', 'UI Kits'],
  ['/c/components', 'Components'], ['/c/email', 'Email'], ['/c/presentations', 'Presentations'], ['/c/concepts', 'Concepts'],
];

function splitTitle(title: string) {
  const i = title.indexOf(' — ');
  return i === -1 ? [title, ''] : [title.slice(0, i), title.slice(i + 3)];
}

export default async function HomePage() {
  const { templateOfTheDay: tod, trending, fresh, mobile, creators } = await getHome();
  const mentions = [...trending, ...fresh]
    .filter((t, i, all) => !t.award && all.findIndex((x) => x.id === t.id) === i && t.vote_count >= 5)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 4);

  if (!tod) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-24 md:px-10">
        <EmptyState title="Nothing here yet" body="Be the first to publish a template on Yowkly."
          action={<Link href="/upload" className="btn btn-primary">Upload a template</Link>} />
      </div>
    );
  }

  const [lead, rest] = splitTitle(tod.title);
  return (
    <>
      {/* Template of the Day */}
      <section aria-label={tod.award ? 'Template of the Day' : 'Featured template'} className="relative h-[520px] overflow-hidden md:h-[600px]">
        <div className="absolute inset-0">
          <Cover seed={tod.slug} title={tod.title} coverPath={tod.cover_path} kind={tod.category_kind} priority />
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,14,12,0)_30%,rgba(15,14,12,.92)_82%,#0F0E0C_100%)]" />
        <div className="absolute inset-x-4 bottom-8 mx-auto flex max-w-[1360px] flex-col items-start justify-between gap-6 md:inset-x-10 md:bottom-11 md:flex-row md:items-end md:gap-10">
          <div className="flex max-w-[760px] flex-col gap-4 text-[#F2EFE8]">
            {tod.award && <AwardRibbon award={tod.award} />}
            <h1 className="m-0 font-display text-[44px] leading-[0.98] font-normal tracking-[-0.02em] md:text-[76px]">
              {lead}{rest && <> — <em>{rest}</em></>}
            </h1>
            <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 text-sm text-[#B8B3A8]">
              <Link href={`/@${tod.owner_username}`} className="relative z-10 inline-flex items-center gap-2 text-[#F2EFE8]">
                <Avatar name={tod.owner_display_name} path={tod.owner_avatar_path} seed={tod.owner_username} size={26} />
                {tod.owner_display_name}
              </Link>
              <Stats score={tod.score} votes={tod.vote_count} likes={tod.like_count} downloads={tod.download_count} size="md" />
              <span className="hidden gap-[5px] sm:flex">
                {displayTools(tod.tools).map((t) => <span key={t} className="chip-tool">{t}</span>)}
                {tod.tags.filter((g) => g.type === 'stack').slice(0, 2).map((g) => <span key={g.slug} className="chip-stack">{g.name}</span>)}
              </span>
            </div>
            <div className="mt-1.5 flex gap-2.5">
              <Link href={`/t/${tod.slug}`} className="btn btn-primary btn-lg"><Icon name="eye" size={18} />View template</Link>
              <Link href={`/t/${tod.slug}#download`} className="btn btn-secondary btn-lg border-[#2E2B25] bg-[rgba(15,14,12,.5)] text-[#F2EFE8]">
                <Icon name="download" size={18} />Download
              </Link>
            </div>
          </div>
          <div className="hidden flex-col gap-2 rounded-[14px] bg-[rgba(23,22,19,.78)] px-5 py-[18px] shadow-[inset_0_0_0_1px_#2E2B25] backdrop-blur md:flex">
            <span className="font-mono text-[11px] tracking-[.08em] text-[#948F84] uppercase">Next award in</span>
            <Countdown className="text-[32px] text-[#F2EFE8]" />
            <Link href="/awards" className="inline-flex items-center gap-1 text-[13px] text-[#B8B3A8] hover:text-accent">
              See the nominees <Icon name="chevronRight" size={14} />
            </Link>
          </div>
        </div>
      </section>

      <nav aria-label="Categories" className="mx-auto max-w-[1440px] overflow-x-auto px-4 pt-7 md:px-10">
        <div className="flex gap-2">
          {CHIPS.map(([href, label]) => <Link key={href} href={href} className="filter-chip">{label}</Link>)}
        </div>
      </nav>

      <div className="mx-auto flex max-w-[1440px] flex-col gap-14 px-4 pt-12 md:px-10">
        <section className="flex flex-col gap-5">
          <SectionHeader title="Trending now" href="/explore" />
          <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
            {trending.slice(0, 4).map((t, i) => <TemplateCard key={t.id} t={t} priority={i < 2} />)}
          </div>
        </section>

        {fresh.length > 0 && (
          <section className="flex flex-col gap-5">
            <SectionHeader title="Fresh this week" href="/explore?sort=newest" />
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
              {fresh.slice(0, 4).map((t) => <TemplateCard key={t.id} t={t} />)}
            </div>
          </section>
        )}

        {mobile.length > 0 && (
          <section className="flex flex-col gap-5">
            <SectionHeader title="Top in Mobile App Designs" href="/c/mobile-apps" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-9 lg:grid-cols-4">
              {mobile.map((t) => <TemplateCard key={t.id} t={t} tall />)}
              <Link href="/c/mobile-apps" className="col-span-2 flex flex-col justify-end gap-2 rounded-lg bg-surface-1 p-6 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2 lg:col-span-1">
                <span className="font-display text-3xl leading-none">Mobile designs, in phone frames.</span>
                <span className="text-ink-2">iOS, Android, Flutter and React Native.</span>
                <span className="mt-2 inline-flex items-center gap-1 font-medium text-accent-ink">Browse mobile <Icon name="arrowRight" size={16} /></span>
              </Link>
            </div>
          </section>
        )}

        {creators.length > 0 && (
          <section className="flex flex-col gap-5">
            <SectionHeader title="Rising creators" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {creators.map((c) => (
                <article key={c.id} className="relative flex items-center gap-3 rounded-lg bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2">
                  <Avatar name={c.display_name} path={c.avatar_path} seed={c.username} size={44} />
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/@${c.username}`} className="truncate font-semibold after:absolute after:inset-0 after:content-['']">{c.display_name}</Link>
                    <span className="truncate text-[13px] text-ink-2">{c.location ?? `@${c.username}`}</span>
                    <span className="font-mono text-xs text-ink-3">{formatCompact(c.followers)} followers · {c.template_count} templates</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {mentions.length > 0 && (
          <section className="flex flex-col gap-3">
            <SectionHeader title="Honorable mentions" />
            <p className="m-0 -mt-1 text-ink-2">High-scoring work from this week that hasn&apos;t won an award yet.</p>
            <div className="grid gap-1 md:grid-cols-2">
              {mentions.map((t) => <TemplateRow key={t.id} t={t} />)}
            </div>
          </section>
        )}
      </div>

      <SignupBand />
    </>
  );
}
