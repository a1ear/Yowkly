import { NextResponse } from 'next/server';
import { userClient } from '@/lib/supabase/clients';
import { rateLimit } from '@/lib/rate-limit';

/**
 * Presence heartbeat: the browser calls this about once a minute while the site
 * is open, saying whether the person has actually used the page recently.
 * Only ever updates the caller's own row (touch_presence).
 */
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return NextResponse.json({ ok: false }, { status: 401, headers });
  const rl = await rateLimit('presence', uid);
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429, headers });
  const body = await request.json().catch(() => ({}));
  const { error } = await db.rpc('touch_presence', { p_active: body?.active === true });
  const { data: unread } = await db.rpc('my_unread_messages');
  return NextResponse.json({ ok: !error, unreadMessages: (unread as number | null) ?? 0 }, { status: error ? 500 : 200, headers });
}
