'use server';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { userClient } from '@/lib/supabase/clients';

export type NotificationItem = {
  id: number; type: string; data: Record<string, unknown>; read_at: string | null; created_at: string;
  actor: { username: string; display_name: string } | null;
  template: { slug: string; title: string } | null;
};

/** The signed-in user's latest notifications (RLS limits them to their own). */
export async function loadNotifications(): Promise<NotificationItem[] | null> {
  const db = await userClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  const { data } = await db.from('notifications')
    .select('id, type, data, read_at, created_at, actor:profiles!notifications_actor_id_fkey(username, display_name), template:templates(slug, title)')
    .order('created_at', { ascending: false }).limit(50);
  return (data ?? []) as unknown as NotificationItem[];
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('mark_notifications_read', { p_ids: null });
  if (error) return fail(toUserError(error));
  return { ok: true, data: null };
}
