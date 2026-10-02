import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getChannel, getChannelStaff } from '@/lib/data/channels';
import { getPosts } from '@/lib/data/posts';
import { ChannelBody } from '@/components/channels';
import { Avatar } from '@/components/bits';
import { formatLongDate } from '@/lib/format';

export const revalidate = 60;

export async function generateMetadata(props: PageProps<'/community/c/[slug]'>): Promise<Metadata> {
  const c = await getChannel((await props.params).slug);
  if (!c) return { title: 'Channel not found' };
  return { title: `${c.name} · Channels`, description: c.description ?? `${c.name}, a channel on Yowkly.`, alternates: { canonical: `/community/c/${c.slug}` } };
}

export default async function ChannelPage(props: PageProps<'/community/c/[slug]'>) {
  const { slug } = await props.params;
  const channel = await getChannel(slug);
  if (!channel) notFound();
  const [{ rows }, staff] = await Promise.all([getPosts({ channelId: channel.id }), getChannelStaff(channel.id)]);

  return (
    <div className="mx-auto grid max-w-[1200px] gap-6 px-4 pt-6 pb-16 md:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-5">
        <nav aria-label="Breadcrumb" className="text-[13px] text-ink-3">
          <Link href="/community" className="hover:text-accent-ink">Community</Link> / <Link href="/community/channels" className="hover:text-accent-ink">Channels</Link>
        </nav>
        <header className="flex items-start gap-4">
          <span aria-hidden="true" className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent font-display text-3xl text-on-accent">#</span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="m-0 font-display text-[40px] leading-none font-normal">{channel.name}</h1>
            {channel.description && <p className="m-0 text-ink-2">{channel.description}</p>}
          </div>
        </header>
        <ChannelBody channel={{ id: channel.id, slug: channel.slug, name: channel.name, member_count: channel.member_count }} posts={rows} />
      </div>

      <aside className="flex flex-col gap-5 lg:sticky lg:top-[88px] lg:self-start">
        <section aria-labelledby="about-h" className="flex flex-col gap-2 rounded-2xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
          <h2 id="about-h" className="m-0 text-base font-semibold">About</h2>
          <p className="m-0 text-[13.5px] text-ink-2">Created {formatLongDate(channel.created_at)} by <Link href={`/@${channel.owner_username}`} className="text-accent-ink hover:underline">{channel.owner_display_name}</Link>.</p>
          <p className="m-0 font-mono text-[12px] text-ink-3">{channel.member_count} members · {channel.post_count} posts</p>
        </section>
        {channel.rules && (
          <section aria-labelledby="rules-h" className="flex flex-col gap-2 rounded-2xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
            <h2 id="rules-h" className="m-0 text-base font-semibold">Rules</h2>
            <p className="m-0 text-[13.5px] whitespace-pre-line text-ink-2">{channel.rules}</p>
          </section>
        )}
        <section aria-labelledby="mods-h" className="flex flex-col gap-2 rounded-2xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
          <h2 id="mods-h" className="m-0 text-base font-semibold">Moderators</h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {staff.map((s) => (
              <li key={s.user_id}>
                <Link href={`/@${s.username}`} className="flex items-center gap-2.5 rounded-lg py-1 hover:text-accent-ink">
                  <Avatar name={s.display_name} path={s.avatar_path} seed={s.username} size={28} />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{s.display_name}</span>
                  <span className="font-mono text-[10.5px] text-ink-3 uppercase">{s.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
