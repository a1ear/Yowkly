import type { Metadata } from 'next';
import Link from 'next/link';
import { communityParams, getPopularPostTags, getPosts, POST_PAGE_SIZE } from '@/lib/data/posts';
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
  const [{ rows, total }, popular] = await Promise.all([getPosts({ tag, page }), getPopularPostTags()]);
  const pages = Math.max(1, Math.ceil(total / POST_PAGE_SIZE));
  const href = (p: number) => {
    const qs = new URLSearchParams({ ...(tag ? { tag } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString();
    return qs ? `/community?${qs}` : '/community';
  };

  return (
    <div className="mx-auto max-w-[760px] px-4 pt-10 pb-16 md:px-6">
      <div className="rise flex flex-col gap-2">
        <span className="eyebrow">Community</span>
        <h1 className="m-0 font-display text-[44px] leading-none font-normal md:text-6xl">What devs are saying.</h1>
        <p className="m-0 max-w-xl text-ink-2">Share what you&apos;re building, a lesson you learned or a question for other developers. Add tags so the right people find it.</p>
      </div>

      <div className="mt-8"><PostComposer /></div>

      {(popular.length > 0 || tag) && (
        <nav aria-label="Post tags" className="mt-6 flex flex-wrap gap-2">
          <Link href="/community" aria-current={!tag ? 'page' : undefined} className="filter-chip">All</Link>
          {tag && !popular.some((p) => p.tag === tag) && <Link href={`/community?tag=${tag}`} aria-current="page" className="filter-chip">#{tag}</Link>}
          {popular.map((p) => (
            <Link key={p.tag} href={`/community?tag=${p.tag}`} aria-current={tag === p.tag ? 'page' : undefined} className="filter-chip">#{p.tag}</Link>
          ))}
        </nav>
      )}

      <section aria-label={tag ? `Posts tagged ${tag}` : 'Latest posts'} className="mt-6 flex flex-col gap-4">
        {tag && <p className="m-0 text-[13px] text-ink-3">{formatCount(total)} post{total === 1 ? '' : 's'} tagged #{tag}</p>}
        <PostList posts={rows} emptyText={tag ? `No posts tagged #${tag} yet.` : 'No posts yet. Be the first to share something.'} />
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
