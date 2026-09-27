'use server';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
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

const score = z.number().int().min(1).max(10);
const voteSchema = z.object({
  templateId: uuid,
  design: score,
  usability: score,
  creativity: score,
  codeQuality: score.nullable(),
});

const VOTE_REASONS: Record<string, string> = {
  auth: 'Sign in to vote.',
  own: "You can't vote on your own work.",
  unverified: 'Verify your email to vote.',
  too_new: 'Accounts can vote after 7 days.',
  not_published: 'Voting opens once the template is published.',
};

export async function submitVote(input: z.input<typeof voteSchema>): Promise<ActionResult<{ updated: boolean }>> {
  const parsed = voteSchema.safeParse(input);
  if (!parsed.success) return fail('Rate every criterion from 1 to 10.');
  const v = parsed.data;
  const a = await authed('vote');
  if ('error' in a) return a.error;

  const { data: reason } = await a.db.rpc('vote_eligibility', { p_template: v.templateId });
  if (reason !== 'ok') return fail(VOTE_REASONS[reason as string] ?? 'You cannot vote on this template.', String(reason));

  const row = { design: v.design, usability: v.usability, creativity: v.creativity, code_quality: v.codeQuality };
  const existing = await a.db.from('votes').select('template_id').eq('template_id', v.templateId).eq('user_id', a.uid).maybeSingle();
  const res = existing.data
    ? await a.db.from('votes').update(row).eq('template_id', v.templateId).eq('user_id', a.uid)
    : await a.db.from('votes').insert({ template_id: v.templateId, ...row });
  if (res.error) return fail(toUserError(res.error));
  revalidateTag(templateTag(v.templateId), 'max');
  return { ok: true, data: { updated: Boolean(existing.data) } };
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
