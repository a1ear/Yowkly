import type { Metadata } from 'next';
import Link from 'next/link';
import { communityParams, getPosts, POST_PAGE_SIZE } from '@/lib/data/posts';
import { PostComposer, PostList } from '@/components/posts';
import { FriendsSidebar } from '@/components/friends';
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
    <div className="mx-auto grid max-w-[1400px] gap-6 px-4 pt-6 pb-16 md:px-6 xl:grid-cols-[280px_minmax(0,760px)_280px] xl:justify-center">
      <aside aria-label="Friends" className="hidden xl:block">
        <div className="sticky top-[96px]"><FriendsSidebar /></div>
      </aside>
      <div className="mx-auto w-full max-w-[760px] min-w-0">
      <h1 className="sr-only">Community</h1>

      <details className="group mb-4 xl:hidden">
        <summary className="flex h-11 cursor-pointer list-none items-center justify-between rounded-xl bg-surface-1 px-4 text-sm font-semibold shadow-[inset_0_0_0_1px_var(--line)]">
          Friends<Icon name="chevronDown" size={16} className="transition group-open:rotate-180" />
        </summary>
        <div className="mt-2"><FriendsSidebar /></div>
      </details>

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
    </div>
  );
}
