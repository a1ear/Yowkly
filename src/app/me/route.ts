import { NextResponse } from 'next/server';
import { userClient } from '@/lib/supabase/clients';

/** /me → your public profile (used by the mobile Profile tab). */
export async function GET(request: Request) {
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return NextResponse.redirect(new URL('/auth/sign-in?next=/me', request.url));
  const { data: p } = await db.from('profiles').select('username').eq('id', uid).maybeSingle();
  return NextResponse.redirect(new URL(p ? `/@${p.username}` : '/onboarding', request.url));
}
