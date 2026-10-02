import 'server-only';
import { publicClient } from '@/lib/supabase/clients';

export type Channel = {
  id: string; slug: string; name: string; description: string | null; rules: string | null;
  member_count: number; post_count: number; created_at: string; owner_id: string;
  owner_username: string; owner_display_name: string;
};
export type ChannelStaff = { user_id: string; role: 'owner' | 'mod'; username: string; display_name: string; avatar_path: string | null };

export const CHANNELS_TAG = 'channels';

export async function getChannel(slug: string): Promise<Channel | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(slug)) return null;
  const res = await publicClient([CHANNELS_TAG, `channel:${slug}`]).from('channel_cards').select('*').eq('slug', slug).maybeSingle();
  if (res.error) throw new Error(`Failed to load channel: ${res.error.message}`);
  return res.data as Channel | null;
}

/** All channels, biggest first, optionally matching a name. */
export async function listChannels(q = '', limit = 60): Promise<Channel[]> {
  let query = publicClient([CHANNELS_TAG]).from('channel_cards').select('*').order('member_count', { ascending: false }).limit(limit);
  const term = q.trim().slice(0, 40).replace(/[\\%_]/g, (c) => `\\${c}`);
  if (term) query = query.ilike('name', `%${term}%`);
  const res = await query;
  if (res.error) throw new Error(`Failed to load channels: ${res.error.message}`);
  return res.data as Channel[];
}

/** The owner and moderators, for the channel sidebar. */
export async function getChannelStaff(channelId: string): Promise<ChannelStaff[]> {
  const res = await publicClient([CHANNELS_TAG]).from('channel_members')
    .select('user_id, role, profile:profiles!channel_members_user_id_fkey(username, display_name, avatar_path)')
    .eq('channel_id', channelId).in('role', ['owner', 'mod']).order('role', { ascending: false });
  if (res.error) throw new Error(`Failed to load channel staff: ${res.error.message}`);
  return ((res.data ?? []) as unknown as { user_id: string; role: 'owner' | 'mod'; profile: { username: string; display_name: string; avatar_path: string | null } }[])
    .map((r) => ({ user_id: r.user_id, role: r.role, ...r.profile }));
}
