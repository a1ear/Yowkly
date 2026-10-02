'use client';
import { createBrowserClient } from '@supabase/ssr';

let client: ReturnType<typeof createBrowserClient> | undefined;

export function browserClient() {
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}

/**
 * The browser client with the signed-in user's token handed to Realtime first.
 * Subscribing before the session has loaded would connect as "anonymous", and
 * row-level security would (correctly) send that connection nothing.
 */
export async function realtimeClient() {
  const db = browserClient();
  const { data } = await db.auth.getSession();
  if (data.session) await db.realtime.setAuth(data.session.access_token);
  return db;
}
