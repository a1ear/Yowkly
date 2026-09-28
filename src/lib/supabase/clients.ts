import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';

/**
 * Every server-side request to Supabase gives up after 15 s. Without this, an
 * unreachable project (wrong URL, paused project, IPv6-only db.* host) makes
 * builds and pages hang silently instead of failing with a clear error.
 */
const TIMEOUT_MS = 15_000;
function withTimeout(init?: RequestInit): RequestInit {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout };
}
const timedFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, withTimeout(init));
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error(`Supabase did not answer within ${TIMEOUT_MS / 1000}s at ${publicEnv.NEXT_PUBLIC_SUPABASE_URL}. Check NEXT_PUBLIC_SUPABASE_URL (it must be https://<ref>.supabase.co) and that the project isn't paused.`);
    }
    throw e;
  }
};

/**
 * Per-request client that acts as the signed-in user. RLS applies.
 * Reading cookies makes the route dynamic, so only use this where the
 * response is personal (actions, dashboard, settings).
 */
export async function userClient() {
  const store = await cookies();
  return createServerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { fetch: timedFetch },
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
      fetch: (input, init) => timedFetch(input, { ...init, next: { revalidate, tags } } as RequestInit),
    },
  });
}
