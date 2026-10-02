'use server';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { userClient } from '@/lib/supabase/clients';
import { CHANNELS_TAG } from '@/lib/data/channels';
import { POSTS_TAG } from '@/lib/data/posts';

const uuid = z.uuid();
export type MyChannel = { id: string; slug: string; name: string; member_count: number; role: 'owner' | 'mod' | 'member' };
export type ChannelMember = { user_id: string; role: 'owner' | 'mod' | 'member'; joined_at: string; username: string; display_name: string; avatar_path: string | null };
export type ChannelBan = { user_id: string; reason: string; created_at: string; username: string; display_name: string };
export type ChannelLog = { id: number; action: string; reason: string | null; created_at: string; actor: string | null; target: string | null };

const refresh = (slug?: string) => { updateTag(CHANNELS_TAG); if (slug) updateTag(`channel:${slug}`); };

/** Make a URL-safe channel address from a name ("React Builders!" -> "react-builders"). */
function slugify(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31);
}

export async function createChannel(input: { name: string; slug?: string; description?: string }): Promise<ActionResult<{ slug: string }>> {
  const parsed = z.object({ name: z.string().trim().min(3, 'Channel names are 3 to 40 characters.').max(40, 'Channel names are 3 to 40 characters.'),
    slug: z.string().trim().max(40).optional(), description: z.string().trim().max(300, 'Keep the description under 300 characters.').optional() })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const slug = (parsed.data.slug ? parsed.data.slug.toLowerCase() : slugify(parsed.data.name)) || 'channel';
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('create_channel', { p_name: parsed.data.name, p_slug: slug, p_description: parsed.data.description || null });
  if (error) return fail(toUserError(error));
  refresh(slug);
  return { ok: true, data: { slug } };
}

export async function myChannels(): Promise<MyChannel[] | null> {
  const db = await userClient();
  const { data: c } = await db.auth.getClaims();
  if (!c?.claims?.sub) return null;
  const { data } = await db.rpc('my_channels');
  return (data ?? []) as MyChannel[];
}

/** Your relationship to a channel: role (or null) and whether you're banned (with the reason). */
export async function myChannelState(channelId: string): Promise<{ signedIn: boolean; role: MyChannel['role'] | null; banned: string | null; siteMod: boolean }> {
  if (!uuid.safeParse(channelId).success) return { signedIn: false, role: null, banned: null, siteMod: false };
  const db = await userClient();
  const { data: c } = await db.auth.getClaims();
  const me = c?.claims?.sub as string | undefined;
  if (!me) return { signedIn: false, role: null, banned: null, siteMod: false };
  const [{ data: m }, { data: b }, { data: mod }] = await Promise.all([
    db.from('channel_members').select('role').eq('channel_id', channelId).eq('user_id', me).maybeSingle(),
    db.from('channel_bans').select('reason').eq('channel_id', channelId).eq('user_id', me).maybeSingle(),
    db.rpc('is_moderator'),
  ]);
  return { signedIn: true, role: (m as { role: MyChannel['role'] } | null)?.role ?? null, banned: (b as { reason: string } | null)?.reason ?? null, siteMod: Boolean(mod) };
}

export async function joinChannel(channelId: string, slug: string): Promise<ActionResult> {
  if (!uuid.safeParse(channelId).success) return fail('Invalid channel.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('join_channel', { p_channel: channelId });
  if (error) return fail(toUserError(error));
  refresh(slug);
  return { ok: true, data: null };
}

export async function leaveChannel(channelId: string, slug: string): Promise<ActionResult> {
  if (!uuid.safeParse(channelId).success) return fail('Invalid channel.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('leave_channel', { p_channel: channelId });
  if (error) return fail(toUserError(error));
  refresh(slug);
  return { ok: true, data: null };
}

/** Members (newest first), optionally filtered by name. Public, like the member count. */
export async function channelMembers(channelId: string, q = ''): Promise<ChannelMember[]> {
  if (!uuid.safeParse(channelId).success) return [];
  const db = await userClient();
  const { data } = await db.from('channel_members')
    .select('user_id, role, joined_at, profile:profiles!channel_members_user_id_fkey(username, display_name, avatar_path)')
    .eq('channel_id', channelId).order('joined_at', { ascending: false }).limit(300);
  const term = q.trim().toLowerCase();
  return ((data ?? []) as unknown as { user_id: string; role: ChannelMember['role']; joined_at: string; profile: { username: string; display_name: string; avatar_path: string | null } }[])
    .map((r) => ({ user_id: r.user_id, role: r.role, joined_at: r.joined_at, ...r.profile }))
    .filter((m) => !term || m.username.toLowerCase().includes(term) || m.display_name.toLowerCase().includes(term))
    .sort((x, y) => ['owner', 'mod', 'member'].indexOf(x.role) - ['owner', 'mod', 'member'].indexOf(y.role));
}

/** Banned people and the mod log: staff only (RLS returns nothing otherwise). */
export async function channelStaffData(channelId: string): Promise<{ bans: ChannelBan[]; log: ChannelLog[] }> {
  if (!uuid.safeParse(channelId).success) return { bans: [], log: [] };
  const db = await userClient();
  const [{ data: bans }, { data: log }] = await Promise.all([
    db.from('channel_bans').select('user_id, reason, created_at, profile:profiles!channel_bans_user_id_fkey(username, display_name)').eq('channel_id', channelId).order('created_at', { ascending: false }),
    db.from('channel_mod_log').select('id, action, reason, created_at, target_id, actor:profiles!channel_mod_log_actor_id_fkey(username)').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(100),
  ]);
  return {
    bans: ((bans ?? []) as unknown as { user_id: string; reason: string; created_at: string; profile: { username: string; display_name: string } }[])
      .map((b) => ({ user_id: b.user_id, reason: b.reason, created_at: b.created_at, ...b.profile })),
    log: ((log ?? []) as unknown as { id: number; action: string; reason: string | null; created_at: string; target_id: string | null; actor: { username: string } | null }[])
      .map((l) => ({ id: l.id, action: l.action, reason: l.reason, created_at: l.created_at, actor: l.actor?.username ?? null, target: l.target_id })),
  };
}

export async function setChannelRole(channelId: string, userId: string, role: 'mod' | 'member', slug: string): Promise<ActionResult> {
  if (!uuid.safeParse(channelId).success || !uuid.safeParse(userId).success) return fail('Invalid request.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('set_channel_role', { p_channel: channelId, p_user: userId, p_role: role });
  if (error) return fail(toUserError(error));
  refresh(slug);
  return { ok: true, data: null };
}

export async function moderateMember(channelId: string, userId: string, action: 'kick' | 'ban' | 'unban', reason: string, slug: string): Promise<ActionResult> {
  if (!uuid.safeParse(channelId).success || !uuid.safeParse(userId).success || !['kick', 'ban', 'unban'].includes(action)) return fail('Invalid request.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('moderate_channel_member', { p_channel: channelId, p_user: userId, p_action: action, p_reason: reason.trim().slice(0, 500) || null });
  if (error) return fail(toUserError(error));
  refresh(slug);
  return { ok: true, data: null };
}

export async function updateChannel(channelId: string, input: { name: string; description: string; rules: string }, slug: string): Promise<ActionResult> {
  if (!uuid.safeParse(channelId).success) return fail('Invalid channel.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('update_channel', { p_channel: channelId, p_name: input.name, p_description: input.description, p_rules: input.rules });
  if (error) return fail(toUserError(error));
  refresh(slug);
  return { ok: true, data: null };
}

export async function deleteChannel(channelId: string, slug: string): Promise<ActionResult> {
  if (!uuid.safeParse(channelId).success) return fail('Invalid channel.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('delete_channel', { p_channel: channelId });
  if (error) return fail(toUserError(error));
  refresh(slug);
  updateTag(POSTS_TAG);
  return { ok: true, data: null };
}
