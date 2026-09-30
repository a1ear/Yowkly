import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Refreshes the Supabase session cookie and guards private areas.
// This is a redirect for convenience only: every private page and action
// checks the user again on the server, and RLS checks it again in Postgres.
const PRIVATE = ['/dashboard', '/settings', '/upload', '/for-you', '/admin', '/onboarding'];

export async function proxy(request: NextRequest) {
  // Supabase sends the sign-up link to the site root (with ?code=) when its redirect
  // allow-list doesn't contain /auth/callback. Hand the code to the callback so the
  // person ends on the "Email confirmed" page instead of the home page.
  const code = request.nextUrl.searchParams.get('code');
  if (request.nextUrl.pathname === '/' && code) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    url.search = `?code=${encodeURIComponent(code)}&next=${encodeURIComponent('/auth/confirmed')}`;
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
          // Responses that set auth cookies must never be cached by a CDN.
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
        },
      },
    },
  );

  // getClaims() verifies the JWT and refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const path = request.nextUrl.pathname;
  if (!signedIn && PRIVATE.some((p) => path === p || path.startsWith(p + '/'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/sign-in';
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Skip static assets and image optimisation.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml)$).*)'],
};
