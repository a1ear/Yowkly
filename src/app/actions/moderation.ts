'use server';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { templateTag } from '@/lib/data/template';

// Each call re-checks the moderator role inside Postgres (moderate_template / resolve_report).
export async function moderateTemplate(templateId: string, action: 'approve' | 'reject' | 'remove' | 'restore', reason: string): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid(), action: z.enum(['approve', 'reject', 'remove', 'restore']), reason: z.string().trim().max(1000) })
    .safeParse({ id: templateId, action, reason });
  if (!parsed.success) return fail('Invalid request.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('moderate_template', { p_template: templateId, p_action: action, p_reason: reason || null });
  if (error) return fail(toUserError(error));
  revalidateTag('templates', 'max');
  revalidateTag(templateTag(templateId), 'max');
  return { ok: true, data: null };
}

export async function resolveReport(reportId: string, status: 'resolved' | 'dismissed', note: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(reportId).success) return fail('Invalid report.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('resolve_report', { p_report: reportId, p_status: status, p_note: note.trim().slice(0, 1000) || null });
  if (error) return fail(toUserError(error));
  return { ok: true, data: null };
}

/** Admins only: make a follower a sub-admin (approve / request changes), or take it away. Re-checked by set_sub_admin. */
export async function setSubAdmin(userId: string, on: boolean): Promise<ActionResult> {
  if (!z.uuid().safeParse(userId).success || typeof on !== 'boolean') return fail('Invalid request.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('set_sub_admin', { p_user: userId, p_on: on });
  if (error) return fail(toUserError(error));
  return { ok: true, data: null };
}

// ── Admin-only user tools (each re-checked by an admin_* function in Postgres, and logged) ──
export async function adminSetModerator(userId: string, on: boolean): Promise<ActionResult> {
  if (!z.uuid().safeParse(userId).success) return fail('Invalid user.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('admin_set_moderator', { p_user: userId, p_on: on === true });
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}

export async function adminSetTrust(userId: string, trusted: boolean): Promise<ActionResult> {
  if (!z.uuid().safeParse(userId).success) return fail('Invalid user.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('admin_set_trust', { p_user: userId, p_trusted: trusted === true });
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}

export async function adminSuspend(userId: string, on: boolean, reason?: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(userId).success) return fail('Invalid user.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('admin_suspend', { p_user: userId, p_on: on === true, p_reason: reason?.trim().slice(0, 500) || null });
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}
