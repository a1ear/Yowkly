'use server';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { userClient } from '@/lib/supabase/clients';
import { POSTS_TAG } from '@/lib/data/posts';
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
  const a = await authed('post');
  if ('error' in a) return { error: a.error.error };
  const { error } = await a.db.rpc('create_post', {
    p_body: body.data,
    p_tags: tags.data.split(/[\s,]+/).filter(Boolean),
  });
  if (error) return { error: toUserError(error) };
  updateTag(POSTS_TAG); // the author sees it straight away
  return { ok: true };
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

// The button is optimistic; the posts cache is refreshed so a reload shows the real count next to your like.
export async function setPostLike(postId: string, liked: boolean): Promise<ActionResult<{ liked: boolean }>> {
  if (!uuid.safeParse(postId).success) return fail('Invalid post.');
  const a = await authed('like');
  if ('error' in a) return a.error;
  const res = liked
    ? await a.db.from('post_likes').upsert({ post_id: postId }, { onConflict: 'post_id,user_id', ignoreDuplicates: true })
    : await a.db.from('post_likes').delete().eq('post_id', postId).eq('user_id', a.uid);
  if (res.error) return fail(toUserError(res.error));
  updateTag(POSTS_TAG);
  return { ok: true, data: { liked } };
}

/** Which of these posts the signed-in user liked. Read-only; RLS scopes it to the caller. */
export async function postLikeStates(postIds: string[]): Promise<{ me: string | null; liked: string[] }> {
  const ids = z.array(uuid).max(50).safeParse(postIds);
  if (!ids.success) return { me: null, liked: [] };
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const me = (data?.claims?.sub as string | undefined) ?? null;
  if (!me || !ids.data.length) return { me, liked: [] };
  const { data: rows } = await db.from('post_likes').select('post_id').eq('user_id', me).in('post_id', ids.data);
  return { me, liked: ((rows ?? []) as { post_id: string }[]).map((r) => r.post_id) };
}
