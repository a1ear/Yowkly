import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCreator, getCreatorTemplates, getAwards } from '@/lib/data/public';
import { getPosts } from '@/lib/data/posts';
import { PostComposer, PostList } from '@/components/posts';
import { publicClient } from '@/lib/supabase/clients';
import { Avatar, EmptyState, AwardRibbon } from '@/components/bits';
import { TemplateCard } from '@/components/template-card';
import { Icon } from '@/components/icons';
import { ProfileFollow } from '@/components/profile-follow';
import { ProfileImageEditor } from '@/components/profile-image-editor';
import { formatCompact, formatCount, hash } from '@/lib/format';
import { mediaUrl } from '@/lib/labels';
import { SOCIALS } from '@/lib/social';
import type { Creator } from '@/lib/types';

export const revalidate = 60;

export async function generateMetadata(props: PageProps<'/u/[username]'>): Promise<Metadata> {
  const c = await getCreator((await props.params).username);
  if (!c) return { title: 'Creator not found' };
  return {
    title: `${c.display_name} (@${c.username})`,
    description: c.bio ?? `Templates and designs by ${c.display_name} on Yowkly.`,
    alternates: { canonical: `/@${c.username}` },
    openGraph: c.banner_path ? { images: [{ url: mediaUrl(c.banner_path, 'avatars'), width: 1500, height: 500 }] } : undefined,
  };
}

const TABS = ['posts', 'templates', 'collections', 'ranking'] as const;

/** A creator's own cover photo, or a calm generated one (unique per username) until they add theirs. */
function Cover({ c }: { c: Creator }) {
  if (c.banner_path) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={mediaUrl(c.banner_path, 'avatars')} alt={`${c.display_name}'s cover photo`} className="h-full w-full object-cover" />;
  }
  const hues = [72, 210, 12, 38, 152, 280];
  const h = hues[hash(c.username) % hues.length];
  return (
    <div aria-hidden="true" className="h-full w-full"
         style={{
           background: `radial-gradient(60% 90% at 18% 20%, hsl(${h} 90% 60% / .35), transparent 70%),
                        radial-gradient(50% 80% at 85% 90%, hsl(${(h + 60) % 360} 80% 55% / .22), transparent 70%),
                        linear-gradient(135deg, #1E1C18, #0F0E0C)`,
         }}>
      <div className="h-full w-full opacity-[.07] [background-image:linear-gradient(var(--ink)_1px,transparent_1px),linear-gradient(90deg,var(--ink)_1px,transparent_1px)] [background-size:32px_32px]" />
    </div>
  );
}

export default async function ProfilePage(props: PageProps<'/u/[username]'>) {
  const { username } = await props.params;
  const sp = await props.searchParams;
  const tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (String(sp.tab) as (typeof TABS)[number]) : 'templates';
  const c = await getCreator(username);
  if (!c) notFound();
  const [templates, collections, awards, posts] = await Promise.all([
    getCreatorTemplates(c.id),
    publicClient([`creator:${c.username.toLowerCase()}`]).from('collections')
      .select('id, name, description, collection_items(count)').eq('owner_id', c.id).eq('is_public', true).order('created_at'),
    tab === 'ranking' ? getAwards() : Promise.resolve([]),
    getPosts({ authorId: c.id }),
  ]);
  const myAwards = awards.filter((a) => a.template.owner_id === c.id);
  const cols = (collections.data ?? []) as { id: string; name: string; description: string | null; collection_items: { count: number }[] }[];
  const links = SOCIALS.flatMap((s) => (c[s.key] ? [{ ...s, handle: c[s.key]! }] : []));
  const joined = new Date(c.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const counts: Record<(typeof TABS)[number], number> = { posts: posts.total, templates: templates.length, collections: cols.length, ranking: c.awards + c.dev_awards };

  return (
    <div className="mx-auto max-w-[1200px] md:px-6 md:pt-6">
      {/* Cover + identity */}
      <section aria-label={`${c.display_name}'s profile`} className="overflow-hidden bg-surface-1 shadow-[inset_0_0_0_1px_var(--line)] md:rounded-2xl">
        <div className="hero-zoom relative h-[160px] overflow-hidden sm:h-[240px] lg:h-[320px]">
          <Cover c={c} />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgba(15,14,12,.55))]" />
          <ProfileImageEditor userId={c.id} kind="cover" hasImage={Boolean(c.banner_path)} />
        </div>

        <div className="relative flex flex-col gap-4 px-4 pb-5 md:flex-row md:items-end md:justify-between md:px-8 md:pb-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-5">
            <div className="relative -mt-14 w-fit rounded-full shadow-[0_0_0_5px_var(--surface-1)] md:-mt-20">
              <span className="hidden md:block"><Avatar name={c.display_name} path={c.avatar_path} seed={c.username} size={168} /></span>
              <span className="md:hidden"><Avatar name={c.display_name} path={c.avatar_path} seed={c.username} size={112} /></span>
              <ProfileImageEditor userId={c.id} kind="avatar" hasImage={Boolean(c.avatar_path)} />
            </div>
            <div className="rise flex flex-col gap-1.5 md:pb-2">
              <h1 className="m-0 font-display text-[40px] leading-none font-normal md:text-[52px]">{c.display_name}</h1>
              <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
                <span>@{c.username}</span>
                <span className="text-ink-3">·</span>
                <span><span className="text-ink">{formatCompact(c.followers)}</span> followers</span>
                <span><span className="text-ink">{formatCompact(c.following)}</span> following</span>
                {c.available_for_hire && <span className="rounded-full bg-accent px-2 py-0.5 text-[12px] font-medium text-on-accent">Available for hire</span>}
              </p>
              {links.length > 0 && (
                <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0" aria-label="Profiles elsewhere">
                  {links.map((l) => (
                    <li key={l.key}>
                      <a href={l.url(l.handle)} target="_blank" rel="noopener noreferrer nofollow ugc" aria-label={`${l.label}: ${l.handle}`} title={l.label}
                         className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] transition-[transform,color] hover:-translate-y-0.5 hover:text-accent-ink">
                        <Icon name={l.icon} size={17} />
                      </a>
                    </li>
                  ))}
                  {c.website && (
                    <li>
                      <a href={c.website} target="_blank" rel="noopener noreferrer nofollow ugc" aria-label={`Website: ${c.website.replace(/^https:\/\//, '')}`} title="Website"
                         className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] transition-[transform,color] hover:-translate-y-0.5 hover:text-accent-ink">
                        <Icon name="globe" size={17} />
                      </a>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
          <div className="md:pb-2"><ProfileFollow userId={c.id} username={c.username} /></div>
        </div>

        <nav aria-label="Profile sections" className="flex gap-1 overflow-x-auto border-t border-line px-2 md:px-6">
          {TABS.map((t) => (
            <Link key={t} href={t === 'templates' ? `/@${c.username}` : `/@${c.username}?tab=${t}`} aria-current={tab === t ? 'page' : undefined}
                  className="-mb-px inline-flex h-12 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium capitalize text-ink-2 hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink">
              {t}<span className="font-mono text-[11.5px] text-ink-3">{counts[t]}</span>
            </Link>
          ))}
        </nav>
      </section>

      {/* Wall: intro on the left, work on the right */}
      <div className="mt-5 grid grid-cols-1 gap-5 px-4 md:px-0 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        <aside className="flex flex-col gap-5 lg:sticky lg:top-[96px]">
          <section aria-labelledby="intro" className="rise flex flex-col gap-4 rounded-2xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
            <h2 id="intro" className="m-0 text-lg font-semibold">Intro</h2>
            {c.bio ? <p className="m-0 text-[15px] whitespace-pre-line text-ink">{c.bio}</p> : <p className="m-0 text-ink-3">No bio yet.</p>}
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-ink-2">
              {c.available_for_hire && <li className="flex items-center gap-2.5"><Icon name="briefcase" size={17} className="text-accent-ink" />Open to freelance and full-time work</li>}
              {c.location && <li className="flex items-center gap-2.5"><Icon name="mapPin" size={17} />{c.location}</li>}
              {c.website && (
                <li className="flex min-w-0 items-center gap-2.5">
                  <Icon name="globe" size={17} />
                  <a href={c.website} target="_blank" rel="noopener noreferrer nofollow ugc" className="truncate text-accent-ink hover:underline">{c.website.replace(/^https:\/\//, '').replace(/\/$/, '')}</a>
                </li>
              )}
              {links.map((l) => (
                <li key={l.key} className="flex min-w-0 items-center gap-2.5">
                  <Icon name={l.icon} size={17} />
                  <a href={l.url(l.handle)} target="_blank" rel="noopener noreferrer nofollow ugc" className="truncate hover:text-accent-ink">
                    <span className="text-ink-3">{l.label}</span> · {l.handle}
                  </a>
                </li>
              ))}
              <li className="flex items-center gap-2.5"><Icon name="calendar" size={17} />Joined {joined}</li>
            </ul>
            {c.skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-line pt-4">
                {c.skills.map((s) => <span key={s} className="chip-stack">{s}</span>)}
              </div>
            )}
          </section>

          <dl aria-label="Stats" className="rise m-0 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line shadow-[inset_0_0_0_1px_var(--line)]" style={{ animationDelay: '80ms' }}>
            {[
              ['Templates', formatCount(c.template_count)], ['Votes received', formatCompact(c.votes_received)],
              ['Downloads', formatCompact(c.downloads)], ['Likes received', formatCompact(c.likes_received)],
              ['Top spots', formatCount(c.awards)], ['Dev of the Week', formatCount(c.dev_awards)],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface-1 p-4">
                <dt className="eyebrow">{k}</dt>
                <dd className="m-0 mt-1 font-display text-3xl">{v}</dd>
              </div>
            ))}
          </dl>
        </aside>

        <div className="min-w-0">
          {tab === 'posts' && (
            <div className="flex flex-col gap-4">
              <PostComposer onlyFor={c.id} />
              <PostList posts={posts.rows} emptyText={`${c.display_name} hasn't posted anything yet.`} />
            </div>
          )}

          {tab === 'templates' && (templates.length ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 xl:grid-cols-3">{templates.map((t) => <TemplateCard key={t.id} t={t} />)}</div>
          ) : <EmptyState title="No templates yet" body={`${c.display_name} hasn't published anything yet.`} />)}

          {tab === 'collections' && (cols.length ? (
            <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
              {cols.map((col) => (
                <li key={col.id}>
                  <Link href={`/collections/${col.id}`} className="card-hover flex flex-col gap-1 rounded-xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2">
                    <span className="font-semibold">{col.name}</span>
                    <span className="text-[13px] text-ink-3">{col.collection_items[0]?.count ?? 0} templates</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No public collections" />)}

          {tab === 'ranking' && (myAwards.length ? (
            <ul className="m-0 grid list-none gap-6 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {myAwards.map((a) => (
                <li key={a.id} className="flex flex-col gap-3"><AwardRibbon award={{ period: a.period, period_start: a.period_start, category: a.category?.name ?? null }} /><TemplateCard t={a.template} /></li>
              ))}
            </ul>
          ) : <EmptyState title="Not ranked yet" body="The Ranking is decided by community votes every day, week and month." />)}
        </div>
      </div>
    </div>
  );
}
