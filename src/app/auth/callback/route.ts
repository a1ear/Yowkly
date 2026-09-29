import { NextResponse } from 'next/server';
import { userClient } from '@/lib/supabase/clients';
import { safeNext } from '@/lib/safe-next';

/** OAuth, email confirmation, magic link and password recovery all land here (PKCE code exchange). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  if (code) {
    const db = await userClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) {
      // First sign-in (any method): pick interests before anything else.
      const { data: claims } = await db.auth.getClaims();
      const uid = claims?.claims?.sub;
      const { data: profile } = uid ? await db.from('profiles').select('onboarded_at').eq('id', uid).maybeSingle() : { data: null };
      const target = profile && !profile.onboarded_at ? '/onboarding' : next;
      return NextResponse.redirect(new URL(target, url.origin), { headers: { 'Cache-Control': 'no-store' } });
    }
  }
  return NextResponse.redirect(new URL('/auth/sign-in?error=link', url.origin));
}
