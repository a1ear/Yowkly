'use server';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { userClient } from '@/lib/supabase/clients';

const uuid = z.uuid();
export type IncomingCall = {
  id: string; conversation_id: string; caller_id: string; video: boolean; created_at: string;
  caller_username: string; caller_display_name: string; caller_avatar_path: string | null;
  is_group: boolean; group_title: string | null;
};
export type CallPerson = { user_id: string; username: string; display_name: string; avatar_path: string | null };
export type LiveGroupCall = { id: string; video: boolean; joined: number; started_by: string };

/** Ring a friend. start_call checks friendship, blocks, "already in a call" and a rate limit. */
export async function startCall(conversationId: string, video: boolean): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(conversationId).success) return fail('Invalid conversation.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { data, error } = await a.db.rpc('start_call', { p_conversation: conversationId, p_video: video === true });
  if (error) return fail(toUserError(error));
  return { ok: true, data: { id: data as string } };
}

export async function answerCall(callId: string): Promise<ActionResult> {
  if (!uuid.safeParse(callId).success) return fail('Invalid call.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { data, error } = await a.db.rpc('answer_call', { p_call: callId });
  if (error) return fail(toUserError(error));
  return data === 'answered' ? { ok: true, data: null } : fail('That call has ended.');
}

export async function declineCall(callId: string): Promise<ActionResult> {
  if (!uuid.safeParse(callId).success) return fail('Invalid call.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('decline_call', { p_call: callId });
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}

export async function endCall(callId: string): Promise<ActionResult> {
  if (!uuid.safeParse(callId).success) return fail('Invalid call.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('end_call', { p_call: callId });
  return error ? fail(toUserError(error)) : { ok: true, data: null };
}

/** A call ringing for you right now, with who's calling. */
export async function incomingCall(): Promise<IncomingCall | null> {
  const db = await userClient();
  const { data: c } = await db.auth.getClaims();
  if (!c?.claims?.sub) return null;
  const { data } = await db.rpc('my_incoming_call');
  return ((data ?? []) as IncomingCall[])[0] ?? null;
}

/** Status of one of your calls (to notice the other side hanging up or declining). */
export async function callStatus(callId: string): Promise<string | null> {
  if (!uuid.safeParse(callId).success) return null;
  const db = await userClient();
  const { data } = await db.from('calls').select('status').eq('id', callId).maybeSingle();
  return (data as { status: string } | null)?.status ?? null;
}

// ─────────────────────────────────────────────── group calls
/** Start a call in a group (everyone else rings), or join the one already going there. */
export async function startGroupCall(conversationId: string, video: boolean): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(conversationId).success) return fail('Invalid group.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { data, error } = await a.db.rpc('start_group_call', { p_conversation: conversationId, p_video: video === true });
  if (error) return fail(toUserError(error));
  return { ok: true, data: { id: data as string } };
}

export async function joinGroupCall(callId: string): Promise<ActionResult> {
  if (!uuid.safeParse(callId).success) return fail('Invalid call.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { data, error } = await a.db.rpc('join_group_call', { p_call: callId });
  if (error) return fail(toUserError(error));
  if (data === 'full') return fail('This call is full (6 people).');
  return data === 'joined' ? { ok: true, data: null } : fail('That call has ended.');
}

export async function declineGroupCall(callId: string): Promise<void> {
  if (!uuid.safeParse(callId).success) return;
  const db = await userClient();
  await db.rpc('decline_group_call', { p_call: callId });
}

/** Check in (every few seconds while in a group call): the call's status and who is in it. */
export async function groupCallPulse(callId: string): Promise<{ status: string; participants: CallPerson[] } | null> {
  if (!uuid.safeParse(callId).success) return null;
  const db = await userClient();
  const { data } = await db.rpc('group_call_pulse', { p_call: callId });
  return (data ?? null) as { status: string; participants: CallPerson[] } | null;
}

/** The call going on in a group right now, if any. */
export async function liveGroupCall(conversationId: string): Promise<LiveGroupCall | null> {
  if (!uuid.safeParse(conversationId).success) return null;
  const db = await userClient();
  const { data } = await db.rpc('live_group_call', { p_conversation: conversationId });
  return ((data ?? []) as LiveGroupCall[])[0] ?? null;
}
