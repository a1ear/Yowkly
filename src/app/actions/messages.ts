'use server';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { userClient } from '@/lib/supabase/clients';
import { presignView } from '@/lib/r2';
import { getCardsBySlugs, searchCreators } from '@/lib/data/public';
import type { TemplateCard } from '@/lib/types';

const uuid = z.uuid();

export type GroupFace = { username: string; display_name: string; avatar_path: string | null };
/**
 * A row in your inbox. For a group, other_display_name is the group's name and the
 * other_* person fields are empty; `members` has up to three other members for the picture.
 */
export type Conversation = {
  id: string; other_id: string | null; other_username: string | null; other_display_name: string; other_avatar_path: string | null;
  status: 'active' | 'request' | 'declined'; incoming_request: boolean; last_message_at: string | null;
  last_preview: string | null; last_from_me: boolean; unread: number; is_friend: boolean;
  kind: 'direct' | 'group'; member_count: number; members: GroupFace[]; my_role: 'admin' | 'member' | null;
  last_sender_name: string | null; last_kind: 'text' | 'call' | 'system' | null;
};
export type ChatImage = { path: string; url?: string; width: number | null; height: number | null };
export type ChatMessage = {
  id: string; conversation_id: string; sender_id: string; body: string; images: ChatImage[];
  deleted_at: string | null; created_at: string;
  kind?: 'text' | 'call' | 'system';
  /** Who sent it (shown above messages in group chats). */
  sender?: GroupFace | null;
};
const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, body, images, deleted_at, created_at, kind, sender:profiles!messages_sender_id_fkey(username, display_name, avatar_path)';

/** Your inbox (chats and requests), newest first. Null when signed out. */
export async function listConversations(): Promise<Conversation[] | null> {
  const db = await userClient();
  const { data: c } = await db.auth.getClaims();
  if (!c?.claims?.sub) return null;
  const { data } = await db.rpc('my_conversations');
  return (data ?? []) as Conversation[];
}

/** Open (or create) the conversation with someone. start_conversation checks blocks and makes it a request unless you're friends. */
export async function openConversation(userId: string): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(userId).success) return fail('Invalid user.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { data, error } = await a.db.rpc('start_conversation', { p_other: userId });
  if (error) return fail(toUserError(error));
  return { ok: true, data: { id: data as string } };
}

/** Short-lived links for photos, only for the ones the caller may see (members of their conversation). */
export async function signChatPhotos(paths: string[]): Promise<Record<string, string>> {
  const list = z.array(z.string().max(200)).max(200).safeParse(paths);
  if (!list.success || !list.data.length) return {};
  const db = await userClient();
  const { data } = await db.rpc('visible_message_images', { p_paths: list.data });
  const allowed = (data ?? []) as string[];
  const out: Record<string, string> = {};
  await Promise.all(allowed.map(async (p) => { out[p] = await presignView('template-files', p); }));
  return out;
}

async function withPhotoLinks(rows: ChatMessage[]) {
  const links = await signChatPhotos(rows.flatMap((m) => m.images.map((i) => i.path)));
  return rows.map((m) => ({ ...m, images: m.images.map((i) => ({ ...i, url: links[i.path] })) }));
}

/** Up to 50 messages before `before` (newest last). RLS returns nothing unless you're in the conversation. */
export async function loadMessages(conversationId: string, before?: string): Promise<ChatMessage[]> {
  if (!uuid.safeParse(conversationId).success) return [];
  const db = await userClient();
  let q = db.from('messages').select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(50);
  if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before);
  const { data } = await q;
  return withPhotoLinks(((data ?? []) as unknown as ChatMessage[]).reverse());
}

/** One message (e.g. one that just arrived over Realtime), with photo links. */
export async function loadMessage(messageId: string): Promise<ChatMessage | null> {
  if (!uuid.safeParse(messageId).success) return null;
  const db = await userClient();
  const { data } = await db.from('messages').select(MESSAGE_COLUMNS).eq('id', messageId).maybeSingle();
  if (!data) return null;
  return (await withPhotoLinks([data as unknown as ChatMessage]))[0];
}

export async function sendMessage(conversationId: string, body: string, photos: string[]): Promise<ActionResult<ChatMessage>> {
  const parsed = z.object({ id: uuid, body: z.string().max(4000), photos: z.array(z.string().max(200)).max(4) })
    .safeParse({ id: conversationId, body, photos });
  if (!parsed.success) return fail('That message is too long.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { data, error } = await a.db.rpc('send_message', {
    p_conversation: conversationId, p_body: parsed.data.body, p_images: parsed.data.photos.map((path) => ({ path })),
  });
  if (error) return fail(toUserError(error));
  const msg = await loadMessage(data as string);
  return msg ? { ok: true, data: msg } : fail('Sent. Reload to see it.');
}

export async function markConversationRead(conversationId: string): Promise<void> {
  if (!uuid.safeParse(conversationId).success) return;
  const db = await userClient();
  await db.rpc('mark_conversation_read', { p_conversation: conversationId });
}

export async function respondToRequest(conversationId: string, accept: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(conversationId).success) return fail('Invalid request.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('respond_to_request', { p_conversation: conversationId, p_accept: accept === true });
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}

export async function unsendMessage(messageId: string): Promise<ActionResult> {
  if (!uuid.safeParse(messageId).success) return fail('Invalid message.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('delete_message', { p_message: messageId });
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}

export async function setBlocked(userId: string, on: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(userId).success) return fail('Invalid user.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('set_block', { p_user: userId, p_on: on === true });
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}

export async function isBlocked(userId: string): Promise<boolean> {
  if (!uuid.safeParse(userId).success) return false;
  const db = await userClient();
  const { data } = await db.from('user_blocks').select('blocked_id').eq('blocked_id', userId).maybeSingle();
  return Boolean(data);
}

/** Preview cards for Yowkly template links pasted into a chat (published templates only). */
export async function chatTemplateCards(slugs: string[]): Promise<TemplateCard[]> {
  const list = z.array(z.string().regex(/^[a-z0-9-]{1,90}$/)).max(10).safeParse(slugs);
  if (!list.success || !list.data.length) return [];
  return getCardsBySlugs(list.data);
}

export type PersonResult = { id: string; username: string; display_name: string; avatar_path: string | null; is_friend: boolean };

/** People to start a chat with, by username or name. Your friends come first; you're left out. */
export async function searchPeople(q: string): Promise<PersonResult[]> {
  const term = typeof q === 'string' ? q.trim().slice(0, 60) : '';
  if (term.replace(/^@/, '').length < 2) return [];
  const db = await userClient();
  const { data: c } = await db.auth.getClaims();
  const me = c?.claims?.sub as string | undefined;
  if (!me) return [];
  const [people, { data: friends }] = await Promise.all([
    searchCreators(term, 12),
    db.rpc('my_friends'),
  ]);
  const friendIds = new Set(((friends ?? []) as { id: string }[]).map((f) => f.id));
  return people.filter((p) => p.id !== me)
    .map((p) => ({ id: p.id, username: p.username, display_name: p.display_name, avatar_path: p.avatar_path, is_friend: friendIds.has(p.id) }))
    .sort((a, b) => Number(b.is_friend) - Number(a.is_friend))
    .slice(0, 8);
}

// ─────────────────────────────────────────────── group chats
// Every rule (friends only, admins only, 10 people, creator protected) lives in the
// database functions; these only check the shape of what was sent.

export type GroupMember = {
  user_id: string; username: string; display_name: string; avatar_path: string | null;
  role: 'admin' | 'member'; is_creator: boolean; is_friend: boolean;
};
export type FriendPick = { id: string; username: string; display_name: string; avatar_path: string | null };

const title = z.string().trim().min(1, 'Give the group a name.').max(60, 'Group names can be up to 60 characters.');
const people = z.array(uuid).min(1).max(20);

/** Your friends, to pick group members from. */
export async function listFriendsToAdd(): Promise<FriendPick[]> {
  const db = await userClient();
  const { data } = await db.rpc('my_friends');
  return ((data ?? []) as FriendPick[]).map(({ id, username, display_name, avatar_path }) => ({ id, username, display_name, avatar_path }));
}

export async function createGroup(name: string, members: string[]): Promise<ActionResult<{ id: string }>> {
  const t = title.safeParse(name);
  if (!t.success) return fail(t.error.issues[0].message);
  if (!people.safeParse(members).success) return fail('Pick at least 2 friends for a group.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { data, error } = await a.db.rpc('create_group', { p_title: t.data, p_members: members });
  if (error) return fail(toUserError(error));
  return { ok: true, data: { id: data as string } };
}

export async function groupMembers(conversationId: string): Promise<GroupMember[]> {
  if (!uuid.safeParse(conversationId).success) return [];
  const db = await userClient();
  const { data } = await db.rpc('group_members_of', { p_conversation: conversationId });
  return (data ?? []) as GroupMember[];
}

async function groupRpc(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc(fn, args);
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}

export async function addGroupMembers(conversationId: string, members: string[]): Promise<ActionResult> {
  if (!uuid.safeParse(conversationId).success || !people.safeParse(members).success) return fail('Pick someone to add.');
  return groupRpc('add_group_members', { p_conversation: conversationId, p_members: members });
}

export async function removeGroupMember(conversationId: string, userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(conversationId).success || !uuid.safeParse(userId).success) return fail('Invalid member.');
  return groupRpc('remove_group_member', { p_conversation: conversationId, p_user: userId });
}

export async function setGroupAdmin(conversationId: string, userId: string, admin: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(conversationId).success || !uuid.safeParse(userId).success) return fail('Invalid member.');
  return groupRpc('set_group_admin', { p_conversation: conversationId, p_user: userId, p_admin: admin === true });
}

export async function renameGroup(conversationId: string, name: string): Promise<ActionResult> {
  const t = title.safeParse(name);
  if (!uuid.safeParse(conversationId).success) return fail('Invalid group.');
  if (!t.success) return fail(t.error.issues[0].message);
  return groupRpc('rename_group', { p_conversation: conversationId, p_title: t.data });
}

export async function leaveGroup(conversationId: string): Promise<ActionResult> {
  if (!uuid.safeParse(conversationId).success) return fail('Invalid group.');
  return groupRpc('leave_group', { p_conversation: conversationId });
}

/** Set (or with null, remove) the group photo. The file is already in your folder of the avatars bucket. */
export async function setGroupPhoto(conversationId: string, path: string | null): Promise<ActionResult> {
  if (!uuid.safeParse(conversationId).success) return fail('Invalid group.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  if (path !== null && !new RegExp(`^${a.uid}/group-[a-z0-9]{8,32}\\.(webp|jpg)$`).test(path)) return fail('Invalid image.');
  const { error } = await a.db.rpc('set_group_photo', { p_conversation: conversationId, p_path: path });
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}
