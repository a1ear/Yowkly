import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';
import { serverEnv } from '@/lib/env.server';

/**
 * Service-role client. It bypasses RLS, so it is used for one job only:
 * signing short-lived download URLs for a path the database already
 * authorised through begin_download(). It never decides who may do what.
 */
export function adminClient() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
