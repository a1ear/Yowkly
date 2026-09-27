import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';

/**
 * Per-request client that acts as the signed-in user. RLS applies.
 * Reading cookies makes the route dynamic, so only use this where the
 * response is personal (actions, dashboard, settings).
 */
export async function userClient() {
  const store = await cookies();
  return createServerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Anonymous, cookie-less client for public pages. Responses go through Next's
 * fetch cache with tags, so public pages are served from cache and revalidated
 * on publish/update instead of hitting Postgres on every view.
 */
export function publicClient(tags: string[] = ['public'], revalidate = 60) {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, next: { revalidate, tags } }),
    },
  });
}
