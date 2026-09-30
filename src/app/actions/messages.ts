'use server';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { userClient } from '@/lib/supabase/clients';
import { presignView } from '@/lib/r2';
import { getCardsBySlugs } from '@/lib/data/public';
import type { TemplateCard } from '@/lib/types';

const uuid = z.uuid();

export type Conversation = {
  id: string; other_id: string; other_username: string; other_display_name: string; other_avatar_path: string | null;
  status: 'active' | 'request' | 'declined'; incoming_request: boolean; last_message_at: string | null;
  last_preview: string | null; last_from_me: boolean; unread: number; is_friend: boolean;
};
export type ChatImage = { path: string; url?: string; width: number | null; height: number | null };
export type ChatMessage = {
  id: string; conversation_id: string; sender_id: string; body: string; images: ChatImage[];
  deleted_at: string | null; created_at: string;
};

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
  let q = db.from('messages').select('id, conversation_id, sender_id, body, images, deleted_at, created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(50);
  if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before);
  const { data } = await q;
  return withPhotoLinks(((data ?? []) as ChatMessage[]).reverse());
}

/** One message (e.g. one that just arrived over Realtime), with photo links. */
export async function loadMessage(messageId: string): Promise<ChatMessage | null> {
  if (!uuid.safeParse(messageId).success) return null;
  const db = await userClient();
  const { data } = await db.from('messages').select('id, conversation_id, sender_id, body, images, deleted_at, created_at').eq('id', messageId).maybeSingle();
  if (!data) return null;
  return (await withPhotoLinks([data as ChatMessage]))[0];
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
