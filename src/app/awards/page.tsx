import type { Metadata } from 'next';
import Link from 'next/link';
import { getAwards } from '@/lib/data/public';
import { Cover } from '@/components/cover';
import { Avatar, AwardRibbon, EmptyState, SectionHeader } from '@/components/bits';
import { Countdown } from '@/components/countdown';
import { Icon } from '@/components/icons';
import { awardLabel } from '@/lib/labels';
import { formatCount, formatLongDate } from '@/lib/format';

export const revalidate = 300;
export const metadata: Metadata = {
  title: 'Awards',
  description: 'Template of the Day, Week and Month — decided by community votes on Yowkly.',
};

export default async function AwardsPage() {
  const awards = await getAwards();
  const label = (a: (typeof awards)[number]) => ({ period: a.period, period_start: a.period_start, category: a.category?.name ?? null });
  const today = awards.find((a) => a.period === 'day' && !a.category);
  const featured = [awards.find((a) => a.period === 'week'), awards.find((a) => a.period === 'month')].filter(Boolean) as typeof awards;
  const archive = awards.filter((a) => a !== today);

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 font-display text-[56px] leading-none font-normal md:text-[72px]">Awards</h1>
        <p className="m-0 text-ink-2">Next Template of the Day in <Countdown className="text-ink" /></p>
      </div>
      <p className="m-0 mt-3 max-w-2xl text-ink-2">
        Every day at 00:00 UTC the highest-rated template published in the last 7 days (with at least 10 votes) wins.
        Scores use a weighted average so a handful of perfect votes can&apos;t beat hundreds of strong ones. A template can win each award once.
      </p>

      {!today && awards.length === 0 && <div className="mt-10"><EmptyState title="No awards yet" body="The first Template of the Day is decided once templates collect enough votes." /></div>}

      {today && (
        <section aria-labelledby="today" className="mt-10 grid overflow-hidden rounded-2xl bg-surface-1 shadow-[inset_0_0_0_1px_var(--line)] lg:grid-cols-[1.4fr_1fr]">
          <div className="aspect-[16/10] lg:aspect-auto">
            <Cover seed={today.template.slug} title={today.template.title} coverPath={today.template.cover_path} kind={today.template.category_kind} priority />
          </div>
          <div className="flex flex-col justify-center gap-4 p-8">
            <AwardRibbon award={label(today)} />
            <h2 id="today" className="m-0 font-display text-5xl leading-none font-normal">{today.template.title}</h2>
            {today.blurb && <p className="m-0 text-ink-2">{today.blurb}</p>}
            <dl className="m-0 grid grid-cols-3 gap-3">
              {[['Score', Number(today.score_snapshot).toFixed(1)], ['Votes', formatCount(today.vote_count_snapshot)], ['Downloads', formatCount(today.template.download_count)]].map(([k, v]) => (
                <div key={k}><dt className="eyebrow">{k}</dt><dd className="m-0 font-display text-3xl">{v}</dd></div>
              ))}
            </dl>
            <Link href={`/@${today.template.owner_username}`} className="inline-flex items-center gap-2 text-ink-2 hover:text-accent-ink">
              <Avatar name={today.template.owner_display_name} path={today.template.owner_avatar_path} seed={today.template.owner_username} size={26} />
              {today.template.owner_display_name}
            </Link>
            <div className="flex gap-2.5">
              <Link href={`/t/${today.template.slug}`} className="btn btn-primary">View template</Link>
              <Link href={`/t/${today.template.slug}#download`} className="btn btn-secondary"><Icon name="download" size={16} />Download</Link>
            </div>
          </div>
        </section>
      )}

      {featured.length > 0 && (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {featured.map((a) => (
            <Link key={a.id} href={`/t/${a.template.slug}`} className="flex items-center gap-4 rounded-xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2">
              <div className="aspect-[16/10] w-40 shrink-0 overflow-hidden rounded-md">
                <Cover seed={a.template.slug} title={a.template.title} coverPath={a.template.cover_path} kind={a.template.category_kind} />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="eyebrow text-accent-ink">{awardLabel(label(a))}</span>
                <span className="truncate font-semibold">{a.template.title}</span>
                <span className="text-[13px] text-ink-2">{a.template.owner_display_name}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {archive.length > 0 && (
        <section className="mt-16 flex flex-col gap-5">
          <SectionHeader title="Archive" />
          <ol className="m-0 grid list-none gap-x-6 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {archive.map((a) => (
              <li key={a.id} className="relative flex flex-col gap-2">
                <div className="aspect-[16/10] overflow-hidden rounded-lg bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                  <Cover seed={a.template.slug} title={a.template.title} coverPath={a.template.cover_path} kind={a.template.category_kind} />
                </div>
                <span className="font-mono text-[11px] text-ink-3 uppercase">{awardLabel(label(a))}</span>
                <Link href={`/t/${a.template.slug}`} className="truncate font-semibold after:absolute after:inset-0 after:content-['']">{a.template.title}</Link>
                <span className="text-[13px] text-ink-2">{a.template.owner_display_name} · {formatLongDate(a.period_start)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
