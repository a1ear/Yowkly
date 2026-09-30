import Link from 'next/link';
import { getHome } from '@/lib/data/public';
import { Cover } from '@/components/cover';
import { Avatar, AwardRibbon, SectionHeader, Stats } from '@/components/bits';
import { TemplateCard, TemplateRow } from '@/components/template-card';
import { Countdown } from '@/components/countdown';
import { SignupBand } from '@/components/signup-band';
import { Icon } from '@/components/icons';
import { displayTools } from '@/lib/labels';
import { formatCompact } from '@/lib/format';

export const revalidate = 60;

const CHIPS: [string, string][] = [
  ['/explore', 'All'], ['/c/inspo', 'Inspo'], ['/c/websites', 'Websites'], ['/c/mobile-apps', 'Mobile Apps'], ['/c/ui-kits', 'UI Kits'],
  ['/c/components', 'Components'], ['/c/presentations', 'Presentations'], ['/c/concepts', 'Concepts'],
];

function splitTitle(title: string) {
  const i = title.indexOf(' — ');
  return i === -1 ? [title, ''] : [title.slice(0, i), title.slice(i + 3)];
}

export default async function HomePage() {
  const home = await getHome();
  return (
    <>
      <Landing />
      {home.templateOfTheDay && <Showcase home={home} tod={home.templateOfTheDay} />}
      <SignupBand />
    </>
  );
}

type Home = Awaited<ReturnType<typeof getHome>>;

/** The templates, below the landing page: Template of the Day, then trending, fresh and the rest. */
function Showcase({ home, tod }: { home: Home; tod: NonNullable<Home['templateOfTheDay']> }) {
  const { trending, fresh, mobile, creators } = home;
  const mentions = [...trending, ...fresh]
    .filter((t, i, all) => !t.award && all.findIndex((x) => x.id === t.id) === i && t.vote_count >= 3)
    .sort((a, b) => b.vote_count - a.vote_count)
    .slice(0, 4);

  const [lead, rest] = splitTitle(tod.title);
  return (
    <>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 pt-20 md:px-10 md:pt-28">
        <span className="eyebrow">On Yowkly right now</span>
        <h2 className="reveal m-0 font-display text-[40px] leading-none font-normal tracking-[-0.02em] md:text-[56px]">Fresh from the community</h2>
      </div>

      {/* Template of the Day */}
      <div className="mx-auto mt-7 max-w-[1440px] px-4 md:px-10">
      <section aria-label={tod.award ? 'Template of the Day' : 'Featured template'} className="relative h-[480px] overflow-hidden rounded-3xl md:h-[560px]">
        <div className="hero-zoom absolute inset-0">
          <Cover seed={tod.slug} title={tod.title} coverPath={tod.cover_path} kind={tod.category_kind} priority />
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,14,12,0)_30%,rgba(15,14,12,.92)_82%,#0F0E0C_100%)]" />
        <div className="absolute inset-x-5 bottom-6 flex flex-col items-start justify-between gap-6 md:inset-x-9 md:bottom-9 md:flex-row md:items-end md:gap-10">
          <div className="rise flex max-w-[760px] flex-col gap-4 text-[#F2EFE8]">
            {tod.award && <AwardRibbon award={tod.award} />}
            <h3 className="m-0 font-display text-[40px] leading-[0.98] font-normal tracking-[-0.02em] md:text-[64px]">
              {lead}{rest && <> — <em>{rest}</em></>}
            </h3>
            <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 text-sm text-[#B8B3A8]">
              <Link href={`/@${tod.owner_username}`} className="relative z-10 inline-flex items-center gap-2 text-[#F2EFE8]">
                <Avatar name={tod.owner_display_name} path={tod.owner_avatar_path} seed={tod.owner_username} size={26} />
                {tod.owner_display_name}
              </Link>
              <Stats votes={tod.vote_count} likes={tod.like_count} downloads={tod.download_count} size="md" />
              <span className="hidden gap-[5px] sm:flex">
                {displayTools(tod.tools).map((t) => <span key={t} className="chip-tool">{t}</span>)}
                {tod.tags.filter((g) => g.type === 'stack').slice(0, 2).map((g) => <span key={g.slug} className="chip-stack">{g.name}</span>)}
              </span>
            </div>
            <div className="mt-1.5 flex gap-2.5">
              <Link href={`/t/${tod.slug}`} className="btn btn-primary btn-lg"><Icon name="eye" size={18} />View template</Link>
              <Link href="/ranking" className="btn btn-secondary btn-lg border-[#2E2B25] bg-[rgba(15,14,12,.5)] text-[#F2EFE8]">
                <Icon name="trophy" size={18} />See the Ranking
              </Link>
            </div>
          </div>
          <div className="rise hidden flex-col gap-2 rounded-[14px] bg-[rgba(23,22,19,.78)] px-5 py-[18px] shadow-[inset_0_0_0_1px_#2E2B25] backdrop-blur md:flex">
            <span className="font-mono text-[11px] tracking-[.08em] text-[#948F84] uppercase">Next Template of the Day in</span>
            <Countdown className="text-[32px] text-[#F2EFE8]" />
            <Link href="/ranking" className="inline-flex items-center gap-1 text-[13px] text-[#B8B3A8] hover:text-accent">
              See this week&apos;s Ranking <Icon name="chevronRight" size={14} />
            </Link>
          </div>
        </div>
      </section>
      </div>

      <nav aria-label="Categories" className="mx-auto max-w-[1440px] overflow-x-auto px-4 pt-7 md:px-10">
        <div className="flex gap-2">
          {CHIPS.map(([href, label]) => <Link key={href} href={href} className="filter-chip">{label}</Link>)}
        </div>
      </nav>

      <div className="mx-auto flex max-w-[1440px] flex-col gap-14 px-4 pt-12 md:px-10">
        <section className="reveal flex flex-col gap-5">
          <SectionHeader title="Trending now" href="/explore" />
          <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
            {trending.slice(0, 4).map((t, i) => <TemplateCard key={t.id} t={t} priority={i < 2} />)}
          </div>
        </section>

        {fresh.length > 0 && (
          <section className="reveal flex flex-col gap-5">
            <SectionHeader title="Fresh this week" href="/explore?sort=newest" />
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
              {fresh.slice(0, 4).map((t) => <TemplateCard key={t.id} t={t} />)}
            </div>
          </section>
        )}

        {mobile.length > 0 && (
          <section className="reveal flex flex-col gap-5">
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
          <section className="reveal flex flex-col gap-5">
            <SectionHeader title="Rising creators" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {creators.map((c) => (
                <article key={c.id} className="relative flex items-center gap-3 rounded-lg bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2">
                  <Avatar name={c.display_name} path={c.avatar_path} seed={c.username} size={44} />
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/@${c.username}`} className="truncate font-semibold after:absolute after:inset-0 after:content-['']">{c.display_name}</Link>
                    <span className="truncate text-[13px] text-ink-2">{c.location ?? `@${c.username}`}</span>
                    <span className="font-mono text-xs text-ink-3">{formatCompact(c.followers)} followers · {c.template_count} template{c.template_count === 1 ? "" : "s"}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {mentions.length > 0 && (
          <section className="reveal flex flex-col gap-3">
            <SectionHeader title="Honorable mentions" />
            <p className="m-0 -mt-1 text-ink-2">Well-voted work that hasn&apos;t topped the Ranking yet.</p>
            <div className="grid gap-1 md:grid-cols-2">
              {mentions.map((t) => <TemplateRow key={t.id} t={t} />)}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

/** The landing page: what Yowkly is and how it works. It is always the top of the home page. */
function Landing() {
  const steps: [string, string, string][] = [
    ['upload', 'Publish', 'Share a website, app design or UI kit: code, Figma, Photoshop, Canva and more. Every file is virus-scanned.'],
    ['bit', 'Get voted', 'Everyone starts with 100 yowkbits and spends 1 per vote, so a vote means someone really rated your work.'],
    ['trophy', 'Top the Ranking', 'The most-voted work becomes Template of the Day, Week and Month, and the top creator is Dev of the Week.'],
  ];
  return (
    <>
      <section aria-labelledby="welcome" className="hero-glow relative overflow-hidden border-b border-line">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-7 px-4 pt-20 pb-16 md:px-10 md:pt-28 md:pb-24">
          <span className="rise eyebrow inline-flex items-center gap-2 rounded-full px-3 py-1.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />Alpha · by NightPatch
          </span>
          <h1 id="welcome" className="m-0 font-display text-[64px] leading-[0.92] font-normal tracking-[-0.03em] md:text-[128px]">
            <span className="word-rise inline-block" style={{ animationDelay: '80ms' }}>For</span>{' '}
            <span className="word-rise inline-block" style={{ animationDelay: '160ms' }}>Devs</span>{' '}
            <span className="word-rise inline-block italic text-accent-ink" style={{ animationDelay: '240ms' }}>by</span>{' '}
            <span className="word-rise inline-block" style={{ animationDelay: '320ms' }}>Devs.</span>
          </h1>
          <p className="rise m-0 max-w-xl text-[17px] text-ink-2" style={{ animationDelay: '420ms' }}>
            Yowkly is where developers and designers show off web templates, app designs and ideas, and the community votes the best to the top.
          </p>
          <div className="rise flex flex-wrap gap-2.5" style={{ animationDelay: '500ms' }}>
            <Link href="/upload" className="btn btn-primary btn-lg"><Icon name="upload" size={18} />Publish a template</Link>
            <Link href="/explore" className="btn btn-secondary btn-lg"><Icon name="compass" size={18} />Explore templates</Link>
            <Link href="/ranking#yowkbits" className="btn btn-ghost btn-lg">How voting works</Link>
          </div>
        </div>
      </section>

      <section aria-label="How Yowkly works" className="mx-auto grid max-w-[1440px] gap-4 px-4 pt-12 md:grid-cols-3 md:px-10">
        {steps.map(([icon, title, body], i) => (
          <div key={title} className="reveal card-hover flex flex-col gap-3 rounded-2xl bg-surface-1 p-6 shadow-[inset_0_0_0_1px_var(--line)]" style={{ animationDelay: `${i * 80}ms` }}>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-on-accent">
              <Icon name={icon as 'bit'} size={22} strokeWidth={2} />
            </span>
            <h2 className="m-0 font-display text-[30px] leading-none font-normal">{title}</h2>
            <p className="m-0 text-ink-2">{body}</p>
          </div>
        ))}
      </section>
    </>
  );
}
