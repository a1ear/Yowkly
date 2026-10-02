import type { Metadata } from 'next';
import Link from 'next/link';
import { listChannels } from '@/lib/data/channels';
import { NewChannelButton } from '@/components/channel-manage';
import { formatCompact } from '@/lib/format';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Channels',
  description: 'Topic channels in the Yowkly community: find one to join, or start your own.',
  alternates: { canonical: '/community/channels' },
};

export default async function ChannelsPage(props: PageProps<'/community/channels'>) {
  const sp = await props.searchParams;
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 40) : '';
  const channels = await listChannels(q);
  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-8 pb-16 md:px-6">
      <nav aria-label="Breadcrumb" className="text-[13px] text-ink-3"><Link href="/community" className="hover:text-accent-ink">Community</Link></nav>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 font-display text-5xl font-normal">Channels</h1>
          <p className="m-0 mt-1 text-ink-2">Spaces for one topic each. Join to post, or start your own.</p>
        </div>
        <NewChannelButton />
      </div>
      <form action="/community/channels" method="get" className="mt-6 flex max-w-md gap-2">
        <label className="sr-only" htmlFor="cq">Search channels</label>
        <input id="cq" name="q" defaultValue={q} placeholder="Search channels" className="field" />
        <button className="btn btn-secondary">Search</button>
      </form>
      {channels.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-line px-6 py-12 text-center text-ink-2">{q ? 'No channels match.' : 'No channels yet. Be the first to create one.'}</p>
      ) : (
        <ul className="m-0 mt-6 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((c) => (
            <li key={c.id}>
              <Link href={`/community/c/${c.slug}`} className="card-hover flex h-full flex-col gap-2 rounded-2xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2">
                <span className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 font-mono text-accent-ink">#</span>
                  <span className="min-w-0 truncate font-semibold">{c.name}</span>
                </span>
                {c.description && <span className="line-clamp-2 text-[13.5px] text-ink-2">{c.description}</span>}
                <span className="mt-auto font-mono text-[12px] text-ink-3">{formatCompact(c.member_count)} members · {formatCompact(c.post_count)} posts</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
