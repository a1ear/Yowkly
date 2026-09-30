'use server';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { userClient } from '@/lib/supabase/clients';
import { POSTS_TAG, type PostComment } from '@/lib/data/posts';
import { presignUpload } from '@/lib/r2';
import type { FormState } from './profile';

const uuid = z.uuid();

/**
 * Publish a post. Everything is re-checked in Postgres (create_post): verified
 * email, 1 to 1,500 characters, up to 5 clean tags, no repeats, a daily cap.
 */
export async function createPost(_: FormState, form: FormData): Promise<FormState> {
  const body = z.string().max(5000).safeParse(form.get('body') ?? '');
  const tags = z.string().max(500).safeParse(form.get('tags') ?? '');
  if (!body.success || !tags.success) return { error: 'That post is too long.' };
  // Paths are checked against the caller's own pending uploads in create_post.
  const images = z.array(z.object({
    path: z.string().max(200), alt: z.string().max(250).optional(),
    width: z.number().int().optional(), height: z.number().int().optional(),
  })).max(4).safeParse((() => { try { return JSON.parse(String(form.get('images') ?? '[]')); } catch { return null; } })());
  if (!images.success) return { error: 'A post can have up to 4 images.' };
  const a = await authed('post');
  if ('error' in a) return { error: a.error.error };
  const { error } = await a.db.rpc('create_post', {
    p_body: body.data,
    p_tags: tags.data.split(/[\s,]+/).filter(Boolean),
    p_images: images.data,
  });
  if (error) return { error: toUserError(error) };
  updateTag(POSTS_TAG); // the author sees it straight away
  return { ok: true };
}

/** Reserve a path for a post image (prepare_post_image checks type, 5 MB and a daily cap) and sign the upload. */
export async function startPostImageUpload(contentType: string, size: number): Promise<ActionResult<{ path: string; url: string }>> {
  if (typeof contentType !== 'string' || !Number.isInteger(size)) return fail('Invalid image.');
  const a = await authed('upload');
  if ('error' in a) return a.error;
  const { data: path, error } = await a.db.rpc('prepare_post_image', { p_content_type: contentType, p_size: size });
  if (error?.code === 'PGRST202') {
    console.error('[posts] prepare_post_image is missing: run `supabase db push`');
    return fail('Photo uploads are being set up. Try again in a few minutes.');
  }
  if (error) return fail(toUserError(error));
  try {
    return { ok: true, data: { path: path as string, url: await presignUpload('media', path as string, { contentType, size }) } };
  } catch (e) {
    console.error('[posts] presign failed', (e as Error).message);
    return fail('Image uploads are temporarily unavailable. Try again shortly.');
  }
}

/** Authors edit their own posts; update_post re-checks ownership and the same rules as a new post. */
export async function updatePost(postId: string, body: string, tags: string): Promise<ActionResult<{ body: string; tags: string[] }>> {
  const parsed = z.object({ id: uuid, body: z.string().max(5000), tags: z.string().max(500) }).safeParse({ id: postId, body, tags });
  if (!parsed.success) return fail('That post is too long.');
  const a = await authed('post');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('update_post', { p_post: postId, p_body: parsed.data.body, p_tags: parsed.data.tags.split(/[\s,]+/).filter(Boolean) });
  if (error) return fail(toUserError(error));
  const { data } = await a.db.from('posts').select('body, tags').eq('id', postId).single();
  updateTag(POSTS_TAG);
  return data ? { ok: true, data: data as { body: string; tags: string[] } } : fail('Saved. Reload to see it.');
}

/** Authors remove their own posts; moderators need a reason (both enforced by delete_post). */
export async function deletePost(postId: string, reason?: string): Promise<ActionResult> {
  if (!uuid.safeParse(postId).success) return fail('Invalid post.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('delete_post', { p_post: postId, p_reason: reason?.trim().slice(0, 500) || null });
  if (error) return fail(toUserError(error));
  updateTag(POSTS_TAG);
  return { ok: true, data: null };
}

const kindSchema = z.enum(['like', 'dislike']).nullable();
type ReactionTarget = { table: 'post_likes'; column: 'post_id' } | { table: 'post_comment_likes'; column: 'comment_id' };

/**
 * One reaction per person: like, dislike, or none (null) to take it back.
 * Switching updates the existing row. The buttons are optimistic; the posts
 * cache is refreshed so a reload shows the real counts next to your reaction.
 */
async function react(t: ReactionTarget, id: string, kind: 'like' | 'dislike' | null): Promise<ActionResult> {
  const k = kindSchema.safeParse(kind);
  if (!uuid.safeParse(id).success || !k.success) return fail('Invalid request.');
  const a = await authed('like');
  if ('error' in a) return a.error;
  if (k.data === null) {
    const del = await a.db.from(t.table).delete().eq(t.column, id).eq('user_id', a.uid);
    if (del.error) return fail(toUserError(del.error));
  } else {
    const change = () => a.db.from(t.table).update({ kind: k.data }).eq(t.column, id).eq('user_id', a.uid).select(t.column);
    let res = await change();
    if (!res.error && !res.data?.length) {
      const ins = await a.db.from(t.table).insert({ [t.column]: id, kind: k.data });
      // Two quick taps: the other request inserted first, so change that row instead.
      if (ins.error?.code === '23505') res = await change();
      else if (ins.error) return fail(toUserError(ins.error));
    }
    if (res.error) return fail(toUserError(res.error));
  }
  updateTag(POSTS_TAG);
  return { ok: true, data: null };
}

export async function setPostReaction(postId: string, kind: 'like' | 'dislike' | null): Promise<ActionResult> {
  return react({ table: 'post_likes', column: 'post_id' }, postId, kind);
}

export async function setCommentReaction(commentId: string, kind: 'like' | 'dislike' | null): Promise<ActionResult> {
  return react({ table: 'post_comment_likes', column: 'comment_id' }, commentId, kind);
}

/** The signed-in user's reaction to each of these posts. Read-only; RLS scopes it to the caller. */
export async function postReactionStates(postIds: string[]): Promise<{ me: string | null; reactions: Record<string, 'like' | 'dislike'> }> {
  const ids = z.array(uuid).max(50).safeParse(postIds);
  if (!ids.success) return { me: null, reactions: {} };
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const me = (data?.claims?.sub as string | undefined) ?? null;
  if (!me || !ids.data.length) return { me, reactions: {} };
  const { data: rows } = await db.from('post_likes').select('post_id, kind').eq('user_id', me).in('post_id', ids.data);
  return { me, reactions: Object.fromEntries(((rows ?? []) as { post_id: string; kind: 'like' | 'dislike' }[]).map((r) => [r.post_id, r.kind])) };
}

/** Comments on a post, oldest first (up to 100). Public data, read with the caller's own session. */
export async function loadPostComments(postId: string): Promise<PostComment[]> {
  if (!uuid.safeParse(postId).success) return [];
  const db = await userClient();
  const { data } = await db.from('post_comment_cards').select('*').eq('post_id', postId).order('created_at').limit(100);
  return (data ?? []) as PostComment[];
}

/** Add a comment. create_post_comment re-checks everything: verified email, 1 to 800 characters, limits. */
export async function addPostComment(postId: string, body: string): Promise<ActionResult<PostComment>> {
  const parsed = z.object({ id: uuid, body: z.string().max(2000) }).safeParse({ id: postId, body });
  if (!parsed.success) return fail('That comment is too long.');
  const a = await authed('comment');
  if ('error' in a) return a.error;
  const { data: id, error } = await a.db.rpc('create_post_comment', { p_post: postId, p_body: parsed.data.body });
  if (error) return fail(toUserError(error));
  const { data: card } = await a.db.from('post_comment_cards').select('*').eq('id', id as string).single();
  updateTag(POSTS_TAG);
  return card ? { ok: true, data: card as PostComment } : fail('Comment saved, reload to see it.');
}

/** The commenter, the post's author, or a moderator (with a reason) can remove a comment. */
export async function removePostComment(commentId: string, reason?: string): Promise<ActionResult> {
  if (!uuid.safeParse(commentId).success) return fail('Invalid comment.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('delete_post_comment', { p_comment: commentId, p_reason: reason?.trim().slice(0, 500) || null });
  if (error) return fail(toUserError(error));
  updateTag(POSTS_TAG);
  return { ok: true, data: null };
}

/** The signed-in user's reaction to each of these comments. Read-only; RLS scopes it to the caller. */
export async function commentReactionStates(commentIds: string[]): Promise<Record<string, 'like' | 'dislike'>> {
  const ids = z.array(uuid).max(100).safeParse(commentIds);
  if (!ids.success || !ids.data.length) return {};
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const me = data?.claims?.sub as string | undefined;
  if (!me) return {};
  const { data: rows } = await db.from('post_comment_likes').select('comment_id, kind').eq('user_id', me).in('comment_id', ids.data);
  return Object.fromEntries(((rows ?? []) as { comment_id: string; kind: 'like' | 'dislike' }[]).map((r) => [r.comment_id, r.kind]));
}
