import type { Metadata } from 'next';
import Link from 'next/link';
import { getRanking } from '@/lib/data/public';
import { Cover } from '@/components/cover';
import { Avatar, AwardRibbon, EmptyState, SectionHeader } from '@/components/bits';
import { Countdown } from '@/components/countdown';
import { Icon } from '@/components/icons';
import { awardLabel } from '@/lib/labels';
import { formatCount, formatLongDate, formatShortDate } from '@/lib/format';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Ranking',
  description: 'This week’s most-voted templates, Dev of the Week, and every Template of the Day, Week and Month on Yowkly.',
  alternates: { canonical: '/ranking' },
};

const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;

export default async function RankingPage() {
  const { awards, weekTemplates, weekDevs, devAwards } = await getRanking();
  const label = (a: (typeof awards)[number]) => ({ period: a.period, period_start: a.period_start, category: a.category?.name ?? null });
  const today = awards.find((a) => a.period === 'day' && !a.category);
  const featured = [awards.find((a) => a.period === 'week'), awards.find((a) => a.period === 'month')].filter(Boolean) as typeof awards;
  const archive = awards.filter((a) => a !== today);
  const dev = devAwards[0];

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 font-display text-[56px] leading-none font-normal md:text-[72px]">Ranking</h1>
        <p className="m-0 text-ink-2">Next Template of the Day in <Countdown className="text-ink" /></p>
      </div>
      <p className="rise m-0 mt-3 max-w-2xl text-ink-2" style={{ animationDelay: '60ms' }}>
        Votes decide everything here. Each vote costs its voter one yowkbit, so the order below reflects what developers chose to
        spend on, not what they scrolled past. Likes are free and never move the Ranking.
      </p>

      {/* Live standings */}
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="week-templates" className="rise flex flex-col gap-4 rounded-2xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)] md:p-6" style={{ animationDelay: '120ms' }}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="week-templates" className="m-0 font-display text-[28px] leading-none font-normal">This week</h2>
            <span className="eyebrow">Votes since Monday · updates every minute</span>
          </div>
          {weekTemplates.length === 0 ? (
            <p className="m-0 py-8 text-center text-ink-2">No votes yet this week. <Link href="/explore" className="text-accent-ink underline-offset-4 hover:underline">Find something worth a yowkbit.</Link></p>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {weekTemplates.map(({ template: t, votes }, i) => (
                <li key={t.id} className="rank-row relative flex items-center gap-4 rounded-lg px-2 py-2.5 hover:bg-surface-2">
                  <span className={`w-7 shrink-0 text-center font-display text-2xl leading-none ${i === 0 ? 'text-accent-ink' : 'text-ink-3'}`}>{i + 1}</span>
                  <div className="aspect-[16/10] w-20 shrink-0 overflow-hidden rounded-md bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                    <Cover seed={t.slug} title={t.title} coverPath={t.cover_path} kind={t.category_kind} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link href={`/t/${t.slug}`} className="truncate font-semibold after:absolute after:inset-0 after:content-['']">{t.title}</Link>
                    <span className="truncate text-[13px] text-ink-2">{t.owner_display_name}</span>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[13px] text-ink" aria-label={plural(votes, 'vote')}>
                    <Icon name="bit" size={14} strokeWidth={2} className="text-accent-ink" />{formatCount(votes)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="dev-race" className="rise flex flex-col gap-4 rounded-2xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)] md:p-6" style={{ animationDelay: '180ms' }}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="dev-race" className="m-0 font-display text-[28px] leading-none font-normal">Dev of the Week</h2>
            <span className="eyebrow">Race so far</span>
          </div>
          <p className="m-0 -mt-1 text-[13px] text-ink-2">Votes across all of a creator&apos;s templates this week. Decided Monday 00:06 UTC (5 votes minimum).</p>
          {weekDevs.length === 0 ? (
            <p className="m-0 py-6 text-center text-ink-2">The race opens with the first vote.</p>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {weekDevs.map((d, i) => (
                <li key={d.user_id} className="rank-row relative flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
                  <span className={`w-6 shrink-0 text-center font-display text-xl leading-none ${i === 0 ? 'text-accent-ink' : 'text-ink-3'}`}>{i + 1}</span>
                  <Avatar name={d.creator.display_name} path={d.creator.avatar_path} seed={d.creator.username} size={36} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link href={`/@${d.creator.username}`} className="truncate font-semibold after:absolute after:inset-0 after:content-['']">{d.creator.display_name}</Link>
                    <span className="truncate text-[12.5px] text-ink-3">{plural(d.templates, 'template')}</span>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[13px]"><Icon name="bit" size={14} strokeWidth={2} className="text-accent-ink" />{formatCount(d.votes)}</span>
                </li>
              ))}
            </ol>
          )}
          {dev && (
            <Link href={`/@${dev.creator.username}`} className="mt-auto flex items-center gap-3 rounded-xl bg-accent p-3.5 text-on-accent transition-transform hover:-translate-y-0.5">
              <Icon name="trophy" size={22} strokeWidth={2} />
              <span className="flex min-w-0 flex-col">
                <span className="font-mono text-[11px] tracking-[.08em] uppercase">Dev of the Week · {formatShortDate(dev.week_start)}</span>
                <span className="truncate font-semibold">{dev.creator.display_name} · {plural(dev.vote_count, 'vote')}</span>
              </span>
            </Link>
          )}
        </section>
      </div>

      {/* Winners */}
      {today && (
        <section aria-labelledby="today" className="rise mt-12 grid overflow-hidden rounded-2xl bg-surface-1 shadow-[inset_0_0_0_1px_var(--line)] lg:grid-cols-[1.4fr_1fr]">
          <div className="aspect-[16/10] lg:aspect-auto">
            <Cover seed={today.template.slug} title={today.template.title} coverPath={today.template.cover_path} kind={today.template.category_kind} priority />
          </div>
          <div className="flex flex-col justify-center gap-4 p-8">
            <AwardRibbon award={label(today)} />
            <h2 id="today" className="m-0 font-display text-5xl leading-none font-normal">{today.template.title}</h2>
            {today.blurb && <p className="m-0 text-ink-2">{today.blurb}</p>}
            <dl className="m-0 grid grid-cols-3 gap-3">
              {[
                ['Votes that day', formatCount(today.period_votes ?? today.vote_count_snapshot)],
                ['All-time votes', formatCount(today.template.vote_count)],
                ['Downloads', formatCount(today.template.download_count)],
              ].map(([k, v]) => (
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
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {featured.map((a) => (
            <Link key={a.id} href={`/t/${a.template.slug}`} className="card-hover flex items-center gap-4 rounded-xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2">
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

      {/* How it works */}
      <section id="yowkbits" aria-label="How yowkbits work" className="mt-16 scroll-mt-28">
        <SectionHeader title="How yowkbits work" />
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            ['100 to start', 'Every account gets 100 yowkbits when it signs up. Spend them on the work you think deserves to win.'],
            ['1 vote, 1 yowkbit', 'A vote costs one yowkbit and you can vote for a template once. You can’t vote for your own work.'],
            ['Votes are final', 'Once cast, a vote stays. Rankings count votes received each day, week and month; ties go to whoever got there first.'],
          ].map(([title, body], i) => (
            <div key={title} className="reveal flex flex-col gap-2 rounded-xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-mono text-sm font-semibold text-on-accent">{i + 1}</span>
              <h3 className="m-0 text-base font-semibold">{title}</h3>
              <p className="m-0 text-ink-2">{body}</p>
            </div>
          ))}
        </div>
        <p className="m-0 mt-4 text-[13px] text-ink-3">
          Template of the Day needs at least 3 votes that day, the Week 5 and the Month 10. A template can take each top spot once.
          New accounts can vote 24 hours after signing up.
        </p>
      </section>

      {archive.length > 0 ? (
        <section className="mt-16 flex flex-col gap-5">
          <SectionHeader title="Past winners" />
          <ol className="m-0 grid list-none gap-x-6 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {archive.map((a) => (
              <li key={a.id} className="reveal relative flex flex-col gap-2">
                <div className="card-hover aspect-[16/10] overflow-hidden rounded-lg bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                  <Cover seed={a.template.slug} title={a.template.title} coverPath={a.template.cover_path} kind={a.template.category_kind} />
                </div>
                <span className="font-mono text-[11px] text-ink-3 uppercase">{awardLabel(label(a))}</span>
                <Link href={`/t/${a.template.slug}`} className="truncate font-semibold after:absolute after:inset-0 after:content-['']">{a.template.title}</Link>
                <span className="text-[13px] text-ink-2">{a.template.owner_display_name} · {formatLongDate(a.period_start)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : !today && (
        <div className="mt-16">
          <EmptyState title="No winners yet" body="The first Template of the Day is picked at 00:00 UTC once a template collects 3 votes in a day." />
        </div>
      )}
    </div>
  );
}
