'use server';
import { revalidateTag, updateTag } from 'next/cache';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { userClient } from '@/lib/supabase/clients';
import { templateTag } from '@/lib/data/template';

const uuid = z.uuid();

// Likes do NOT revalidate the page cache: a viral template would otherwise
// rebuild its page on every tap. The button is optimistic; counts catch up
// within the 60 s cache window.
export async function setLike(templateId: string, liked: boolean): Promise<ActionResult<{ liked: boolean }>> {
  if (!uuid.safeParse(templateId).success) return fail('Invalid template.');
  const a = await authed('like');
  if ('error' in a) return a.error;
  const res = liked
    ? await a.db.from('likes').upsert({ template_id: templateId }, { onConflict: 'user_id,template_id', ignoreDuplicates: true })
    : await a.db.from('likes').delete().eq('template_id', templateId).eq('user_id', a.uid);
  if (res.error) return fail(toUserError(res.error));
  return { ok: true, data: { liked } };
}

const VOTE_REASONS: Record<string, string> = {
  auth: 'Sign in to vote.',
  own: "You can't vote on your own work.",
  unverified: 'Verify your email to vote.',
  too_new: 'New accounts can vote 24 hours after signing up.',
  voted: 'You already voted for this template.',
  no_bits: 'You are out of yowkbits.',
  not_published: 'Voting opens once the template is published.',
};

/**
 * Spend 1 yowkbit on a template. Votes are final and one per template; the
 * database (cast_vote) re-checks everything and moves the yowkbit atomically.
 */
export async function castVote(templateId: string): Promise<ActionResult<{ balance: number; voteCount: number }>> {
  if (!uuid.safeParse(templateId).success) return fail('Invalid template.');
  const a = await authed('vote');
  if ('error' in a) return a.error;

  const { data: reason } = await a.db.rpc('vote_eligibility', { p_template: templateId });
  if (reason !== 'ok') return fail(VOTE_REASONS[reason as string] ?? 'You cannot vote on this template.', String(reason));

  const res = await a.db.rpc('cast_vote', { p_template: templateId });
  if (res.error) return fail(toUserError(res.error));
  const [row] = res.data as { balance: number; vote_count: number }[];
  // Read-your-own-write: the voter's next page load must show their vote, not a stale count.
  updateTag(templateTag(templateId));
  return { ok: true, data: { balance: row.balance, voteCount: row.vote_count } };
}

/**
 * Which of these creators the signed-in user follows (for Follow buttons in
 * search results). No rate limit: read-only, and RLS scopes it to the caller.
 */
export async function followStates(userIds: string[]): Promise<{ me: string | null; following: string[] }> {
  const ids = z.array(uuid).max(24).safeParse(userIds);
  if (!ids.success) return { me: null, following: [] };
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const me = (data?.claims?.sub as string | undefined) ?? null;
  if (!me || !ids.data.length) return { me, following: [] };
  const { data: rows } = await db.from('follows').select('followee_id').eq('follower_id', me).in('followee_id', ids.data);
  return { me, following: ((rows ?? []) as { followee_id: string }[]).map((r) => r.followee_id) };
}

export async function setFollow(userId: string, follow: boolean): Promise<ActionResult<{ following: boolean }>> {
  if (!uuid.safeParse(userId).success) return fail('Invalid user.');
  const a = await authed('follow');
  if ('error' in a) return a.error;
  if (a.uid === userId) return fail("You can't follow yourself.");
  const res = follow
    ? await a.db.from('follows').upsert({ followee_id: userId }, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true })
    : await a.db.from('follows').delete().eq('follower_id', a.uid).eq('followee_id', userId);
  if (res.error) return fail(toUserError(res.error));
  return { ok: true, data: { following: follow } };
}

const commentSchema = z.object({
  templateId: uuid,
  parentId: uuid.nullable(),
  body: z.string().trim().min(1, 'Write something first.').max(2000, 'Keep it under 2,000 characters.'),
});

export async function postComment(input: z.input<typeof commentSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid comment.');
  const a = await authed('comment');
  if ('error' in a) return a.error;
  const { templateId, parentId, body } = parsed.data;
  const res = await a.db.from('comments').insert({ template_id: templateId, parent_id: parentId, body }).select('id').single();
  if (res.error) return fail(toUserError(res.error, 'Could not post your comment.'));
  revalidateTag(templateTag(templateId), 'max');
  return { ok: true, data: { id: res.data.id } };
}

export async function editComment(commentId: string, templateId: string, body: string): Promise<ActionResult> {
  const parsed = commentSchema.safeParse({ templateId, parentId: null, body });
  if (!parsed.success || !uuid.safeParse(commentId).success) return fail('Invalid comment.');
  const a = await authed('comment');
  if ('error' in a) return a.error;
  const res = await a.db.from('comments').update({ body: parsed.data.body }).eq('id', commentId).select('id');
  if (res.error) return fail(toUserError(res.error));
  if (!res.data?.length) return fail('Comments can only be edited for 15 minutes.');
  revalidateTag(templateTag(templateId), 'max');
  return { ok: true, data: null };
}

export async function deleteComment(commentId: string, templateId: string): Promise<ActionResult> {
  if (!uuid.safeParse(commentId).success || !uuid.safeParse(templateId).success) return fail('Invalid comment.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const res = await a.db.rpc('delete_comment', { p_comment: commentId });
  if (res.error) return fail(toUserError(res.error));
  revalidateTag(templateTag(templateId), 'max');
  return { ok: true, data: null };
}

const reportSchema = z.object({
  targetType: z.enum(['template', 'comment', 'profile', 'collection']),
  targetId: uuid,
  reason: z.enum(['spam', 'malware', 'copyright', 'inappropriate', 'broken', 'other']),
  details: z.string().trim().max(1000).optional(),
});

export async function fileReport(input: z.input<typeof reportSchema>): Promise<ActionResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return fail('Choose a reason.');
  const a = await authed('report');
  if ('error' in a) return a.error;
  const r = parsed.data;
  const res = await a.db.from('reports').insert({
    target_type: r.targetType, target_id: r.targetId, reason: r.reason, details: r.details || null,
  });
  if (res.error) return fail(toUserError(res.error));
  return { ok: true, data: null };
}
