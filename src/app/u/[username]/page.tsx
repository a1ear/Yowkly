import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCreator, getCreatorTemplates, getAwards } from '@/lib/data/public';
import { publicClient } from '@/lib/supabase/clients';
import { Avatar, EmptyState, AwardRibbon } from '@/components/bits';
import { TemplateCard } from '@/components/template-card';
import { Icon } from '@/components/icons';
import { ProfileFollow } from '@/components/profile-follow';
import { formatCompact, formatCount } from '@/lib/format';

export const revalidate = 60;

export async function generateMetadata(props: PageProps<'/u/[username]'>): Promise<Metadata> {
  const c = await getCreator((await props.params).username);
  if (!c) return { title: 'Creator not found' };
  return {
    title: `${c.display_name} (@${c.username})`,
    description: c.bio ?? `Templates and designs by ${c.display_name} on Yowkly.`,
    alternates: { canonical: `/@${c.username}` },
  };
}

const TABS = ['templates', 'collections', 'ranking', 'about'] as const;

export default async function ProfilePage(props: PageProps<'/u/[username]'>) {
  const { username } = await props.params;
  const sp = await props.searchParams;
  const tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (String(sp.tab) as (typeof TABS)[number]) : 'templates';
  const c = await getCreator(username);
  if (!c) notFound();
  const [templates, collections, awards] = await Promise.all([
    getCreatorTemplates(c.id),
    publicClient([`creator:${c.username.toLowerCase()}`]).from('collections')
      .select('id, name, description, collection_items(count)').eq('owner_id', c.id).eq('is_public', true).order('created_at'),
    tab === 'ranking' ? getAwards() : Promise.resolve([]),
  ]);
  const myAwards = awards.filter((a) => a.template.owner_id === c.id);
  const cols = (collections.data ?? []) as { id: string; name: string; description: string | null; collection_items: { count: number }[] }[];

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-5">
          <Avatar name={c.display_name} path={c.avatar_path} seed={c.username} size={96} />
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 font-display text-[44px] leading-none font-normal md:text-[56px]">{c.display_name}</h1>
            <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
              <span>@{c.username}</span>
              {c.location && <span className="inline-flex items-center gap-1">· {c.location}</span>}
              {c.available_for_hire && <span className="rounded-full bg-accent px-2 py-0.5 text-[12px] font-medium text-on-accent">Available for hire</span>}
            </p>
          </div>
        </div>
        <ProfileFollow userId={c.id} username={c.username} />
      </header>

      {c.bio && <p className="m-0 mt-5 max-w-2xl text-[15px] text-ink-2">{c.bio}</p>}

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Templates', formatCount(c.template_count)], ['Downloads', formatCompact(c.downloads)],
          ['Votes received', formatCompact(c.votes_received)], ['Likes received', formatCompact(c.likes_received)], ['Top spots', formatCount(c.awards + c.dev_awards)], ['Followers', formatCompact(c.followers)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)]">
            <dt className="eyebrow">{k}</dt>
            <dd className="m-0 mt-1 font-display text-3xl">{v}</dd>
          </div>
        ))}
      </dl>

      <nav aria-label="Profile sections" className="mt-10 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <Link key={t} href={t === 'templates' ? `/@${c.username}` : `/@${c.username}?tab=${t}`} aria-current={tab === t ? 'page' : undefined}
                className="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium capitalize text-ink-2 hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink">
            {t}
          </Link>
        ))}
      </nav>

      <div className="mt-8">
        {tab === 'templates' && (templates.length ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">{templates.map((t) => <TemplateCard key={t.id} t={t} />)}</div>
        ) : <EmptyState title="No templates yet" body={`${c.display_name} hasn't published anything yet.`} />)}

        {tab === 'collections' && (cols.length ? (
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {cols.map((col) => (
              <li key={col.id}>
                <Link href={`/collections/${col.id}`} className="flex flex-col gap-1 rounded-lg bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2">
                  <span className="font-semibold">{col.name}</span>
                  <span className="text-[13px] text-ink-3">{col.collection_items[0]?.count ?? 0} templates</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No public collections" />)}

        {tab === 'ranking' && (myAwards.length ? (
          <ul className="m-0 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {myAwards.map((a) => (
              <li key={a.id} className="flex flex-col gap-3"><AwardRibbon award={{ period: a.period, period_start: a.period_start, category: a.category?.name ?? null }} /><TemplateCard t={a.template} /></li>
            ))}
          </ul>
        ) : <EmptyState title="Not ranked yet" body="The Ranking is decided by community votes every day, week and month." />)}

        {tab === 'about' && (
          <div className="flex max-w-2xl flex-col gap-4 text-ink-2">
            {c.skills.length > 0 && <div className="flex flex-wrap gap-2">{c.skills.map((s) => <span key={s} className="chip-stack">{s}</span>)}</div>}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {c.website && <li><a href={c.website} rel="noopener noreferrer nofollow ugc" target="_blank" className="inline-flex items-center gap-2 hover:text-accent-ink"><Icon name="link" size={16} />{c.website.replace(/^https:\/\//, '')}</a></li>}
              {c.github && <li><a href={`https://github.com/${c.github}`} rel="noopener noreferrer nofollow ugc" target="_blank" className="inline-flex items-center gap-2 hover:text-accent-ink"><Icon name="github" size={16} />{c.github}</a></li>}
              {c.x_handle && <li><a href={`https://x.com/${c.x_handle}`} rel="noopener noreferrer nofollow ugc" target="_blank" className="inline-flex items-center gap-2 hover:text-accent-ink">𝕏 @{c.x_handle}</a></li>}
            </ul>
            <p className="m-0 text-[13px] text-ink-3">Joined {new Date(c.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
          </div>
        )}
      </div>
    </div>
  );
}
