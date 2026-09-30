'use server';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { userClient } from '@/lib/supabase/clients';

export type Status = 'online' | 'idle' | 'offline';
export type StatusMode = 'online' | 'idle' | 'invisible';
export type Friend = { id: string; username: string; display_name: string; avatar_path: string | null; status?: Status };

/** Your friends (mutual follows) with their status. Status is only ever computed for friends, in Postgres. */
export async function myFriends(): Promise<Friend[] | null> {
  const db = await userClient();
  const { data: c } = await db.auth.getClaims();
  if (!c?.claims?.sub) return null;
  const { data } = await db.rpc('my_friends');
  return (data ?? []) as Friend[];
}

/** Someone's friends list, if it's yours or they made it public. */
export async function friendsList(userId: string): Promise<{ visible: boolean; own: boolean; friends: Friend[] }> {
  if (!z.uuid().safeParse(userId).success) return { visible: false, own: false, friends: [] };
  const db = await userClient();
  const { data: c } = await db.auth.getClaims();
  const own = c?.claims?.sub === userId;
  const { data: visible } = await db.rpc('can_see_friends', { p_user: userId });
  if (!visible) return { visible: false, own, friends: [] };
  const { data } = await db.rpc('friends_of', { p_user: userId });
  return { visible: true, own, friends: (data ?? []) as Friend[] };
}

/** One person's status, only if you're friends (or it's you); null otherwise. */
export async function userStatus(userId: string): Promise<Status | null> {
  if (!z.uuid().safeParse(userId).success) return null;
  const db = await userClient();
  const { data } = await db.rpc('user_status', { p_user: userId });
  return (data as Status | null) ?? null;
}

export async function setMyStatus(mode: StatusMode): Promise<ActionResult> {
  if (!['online', 'idle', 'invisible'].includes(mode)) return fail('Invalid status.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('set_my_status', { p_mode: mode });
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}

export async function setFriendsPublic(isPublic: boolean): Promise<ActionResult> {
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.from('profiles').update({ friends_public: isPublic === true }).eq('id', a.uid);
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}
