import 'server-only';
import { userClient } from '@/lib/supabase/clients';
import { rateLimit, type LimitName } from '@/lib/rate-limit';

export type Failure = { ok: false; error: string; code?: string };
export type ActionResult<T = null> = { ok: true; data: T } | Failure;

export const fail = (error: string, code?: string): Failure => ({ ok: false, error, code });

// SQLSTATEs our functions raise with messages written for people.
const USER_FACING = new Set(['P0001', 'P0002', '23514', '54000', '28000', '23505', '22023']);

/** Turn a Postgres/PostgREST error into something safe to show. Unknown errors are logged, not leaked. */
export function toUserError(e: { code?: string; message?: string } | null | undefined, fallback = 'Something went wrong. Please try again.') {
  if (!e) return fallback;
  if (e.message?.includes('row-level security') || e.message?.includes('permission denied')) return 'You are not allowed to do that.';
  if (e.code === '23505' && e.message?.includes('duplicate key')) return 'That already exists.';
  // 42501 is also raised by our own guards with readable messages ("This template was removed…").
  if (e.code && (USER_FACING.has(e.code) || e.code === '42501') && e.message) return e.message;
  console.error('[action]', e.code, e.message);
  return fallback;
}

/**
 * Standard preamble for every mutating action: who is calling (verified JWT),
 * and are they within budget. Authorisation itself is Postgres's job (RLS/RPC).
 */
type Authed =
  | { error: Failure }
  | { db: Awaited<ReturnType<typeof userClient>>; uid: string };

export async function authed(limit: LimitName): Promise<Authed> {
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return { error: fail('Sign in to continue.', 'auth') };
  const rl = await rateLimit(limit, uid);
  if (!rl.ok) return { error: fail(`Slow down a little. Try again in ${Math.ceil(rl.retryAfterSec / 60)} min.`, 'rate_limited') };
  return { db, uid };
}
