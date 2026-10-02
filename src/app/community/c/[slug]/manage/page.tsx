import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getChannel } from '@/lib/data/channels';
import { ChannelManager } from '@/components/channel-manage';

export const metadata: Metadata = { title: 'Manage channel', robots: { index: false } };

/** The gate is in the component and in Postgres: only channel staff get data or can act. */
export default async function ManageChannelPage(props: PageProps<'/community/c/[slug]/manage'>) {
  const channel = await getChannel((await props.params).slug);
  if (!channel) notFound();
  return (
    <div className="mx-auto max-w-[960px] px-4 pt-8 pb-16 md:px-6">
      <nav aria-label="Breadcrumb" className="text-[13px] text-ink-3">
        <Link href="/community" className="hover:text-accent-ink">Community</Link> / <Link href={`/community/c/${channel.slug}`} className="hover:text-accent-ink">{channel.name}</Link>
      </nav>
      <h1 className="m-0 mt-2 font-display text-5xl font-normal">Manage {channel.name}</h1>
      <ChannelManager channel={{ id: channel.id, slug: channel.slug, name: channel.name, description: channel.description ?? '', rules: channel.rules ?? '' }} />
    </div>
  );
}
