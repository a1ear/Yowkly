import 'server-only';
import { z } from 'zod';
import { publicClient } from '@/lib/supabase/clients';

export type Post = {
  id: string; body: string; tags: string[]; like_count: number; created_at: string;
  author_id: string; author_username: string; author_display_name: string; author_avatar_path: string | null;
  comment_count: number; dislike_count: number; edited_at: string | null;
  images: { path: string; alt: string | null; width: number | null; height: number | null }[];
  /** The best one or two comments, shown under the post without opening the thread. */
  previews: PostComment[];
};

export type PostComment = {
  id: string; post_id: string; body: string; created_at: string;
  author_id: string; author_username: string; author_display_name: string; author_avatar_path: string | null;
  like_count: number; dislike_count: number;
};

export const POST_PAGE_SIZE = 20;
export const POSTS_TAG = 'posts';

/** Same shape the database accepts for a post tag (see create_post). */
export const postTagParam = z.string().regex(/^[a-z0-9][a-z0-9-]{1,23}$/);

export const communityParams = z.object({
  tag: postTagParam.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100).catch(1),
});

/** Newest first. `authorId` limits it to one creator's posts, `tag` to one topic. */
export async function getPosts(p: { authorId?: string; tag?: string; page?: number }) {
  let q = publicClient([POSTS_TAG]).from('post_cards').select('*', { count: 'exact' });
  if (p.authorId) q = q.eq('author_id', p.authorId);
  if (p.tag) q = q.contains('tags', [p.tag]);
  const from = ((p.page ?? 1) - 1) * POST_PAGE_SIZE;
  const res = await q.order('created_at', { ascending: false }).range(from, from + POST_PAGE_SIZE - 1);
  if (res.error) throw new Error(`Failed to load posts: ${res.error.message}`);
  const cards = res.data as Omit<Post, 'previews'>[];
  // Previews are a nicety: if they fail to load the posts still show.
  const byPost = new Map<string, PostComment[]>();
  if (cards.length) {
    const pre = await publicClient([POSTS_TAG]).rpc('post_comment_previews', { p_post_ids: cards.map((c) => c.id), p_per_post: 2 });
    if (pre.error) console.error('[posts] previews', pre.error.message);
    for (const c of (pre.data ?? []) as PostComment[]) byPost.set(c.post_id, [...(byPost.get(c.post_id) ?? []), c]);
  }
  const rows: Post[] = cards.map((c) => ({ ...c, previews: byPost.get(c.id) ?? [] }));
  return { rows, total: res.count ?? rows.length };
}

export async function getPopularPostTags(limit = 12): Promise<{ tag: string; uses: number }[]> {
  const res = await publicClient([POSTS_TAG], 300).rpc('popular_post_tags', { p_limit: limit });
  if (res.error) throw new Error(`Failed to load post tags: ${res.error.message}`);
  return res.data as { tag: string; uses: number }[];
}
