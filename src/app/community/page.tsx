import type { Metadata } from 'next';
import Link from 'next/link';
import { communityParams, getPosts, POST_PAGE_SIZE } from '@/lib/data/posts';
import { PostComposer, PostList } from '@/components/posts';
import { Icon } from '@/components/icons';
import { formatCount } from '@/lib/format';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Community',
  description: 'What developers and designers on Yowkly are building, learning and asking. Posts from the community, with tags.',
  alternates: { canonical: '/community' },
};

export default async function CommunityPage(props: PageProps<'/community'>) {
  const { tag, page } = communityParams.parse(await props.searchParams);
  const { rows, total } = await getPosts({ tag, page });
  const pages = Math.max(1, Math.ceil(total / POST_PAGE_SIZE));
  const href = (p: number) => {
    const qs = new URLSearchParams({ ...(tag ? { tag } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString();
    return qs ? `/community?${qs}` : '/community';
  };

  return (
    <div className="mx-auto max-w-[760px] px-4 pt-6 pb-16 md:px-6">
      <h1 className="sr-only">Community</h1>

      <div><PostComposer /></div>


      <section aria-label={tag ? `Posts tagged ${tag}` : 'Latest posts'} className="mt-6 flex flex-col gap-4">
        {tag && (
          <p className="m-0 flex items-center gap-2 text-[13px] text-ink-3">
            {formatCount(total)} post{total === 1 ? '' : 's'} tagged <span className="text-ink">{tag}</span>
            <Link href="/community" className="text-accent-ink underline-offset-4 hover:underline">Show all</Link>
          </p>
        )}
        <PostList posts={rows} emptyText={tag ? `No posts tagged ${tag} yet.` : 'No posts yet. Be the first to share something.'} />
      </section>

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-8 flex items-center justify-between">
          {page > 1 ? <Link href={href(page - 1)} className="btn btn-secondary"><Icon name="chevronLeft" size={16} />Newer</Link> : <span />}
          <span className="font-mono text-xs text-ink-3">Page {page} of {pages}</span>
          {page < pages ? <Link href={href(page + 1)} className="btn btn-secondary">Older<Icon name="chevronRight" size={16} /></Link> : <span />}
        </nav>
      )}
    </div>
  );
}
