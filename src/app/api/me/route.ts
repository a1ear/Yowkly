import { NextResponse } from 'next/server';
import { userClient } from '@/lib/supabase/clients';

/**
 * The signed-in user's header info (name, avatar, unread count, yowkbits).
 * Served from the server so public pages don't have to ship the ~65 KB
 * Supabase client just to draw the header. Per-user: never cached.
 */
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return NextResponse.json({ me: null }, { headers });
  const [{ data: p }, { count }, { data: w }, { data: role }, { data: pres }] = await Promise.all([
    db.from('profiles').select('id, username, display_name, avatar_path').eq('id', uid).maybeSingle(),
    db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    db.from('yowkbit_wallets').select('balance').eq('user_id', uid).maybeSingle(),
    db.rpc('my_staff_role'),
    db.rpc('my_presence'),
  ]);
  // role only decides whether the header shows the admin panel link; every admin page and action checks again.
  const me = p ? { ...p, unread: count ?? 0, balance: (w as { balance: number } | null)?.balance ?? 0, role: (role as string | null) ?? null,
    status_mode: ((pres as { status_mode: string }[] | null)?.[0]?.status_mode ?? 'online') } : null;
  return NextResponse.json({ me }, { headers });
}
