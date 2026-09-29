'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { userClient } from '@/lib/supabase/clients';
import { rateLimit } from '@/lib/rate-limit';
import { safeNext } from '@/lib/safe-next';
import { publicEnv } from '@/lib/env';

export type AuthState = { error?: string; message?: string; email?: string } | null;

async function clientKey() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'local';
}

/** Honeypot: a field people never see. Bots that fill every input get a fake success and nothing happens. */
const isBot = (form: FormData) => String(form.get('company_site') ?? '').length > 0;

async function limited() {
  const r = await rateLimit('auth', await clientKey());
  return r.ok ? null : `Too many attempts. Try again in ${Math.ceil(r.retryAfterSec / 60)} minutes.`;
}

const email = z.email('Enter a valid email address.').max(254);
const password = z.string()
  .min(10, 'Use at least 10 characters.')
  .max(72, 'Use at most 72 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/[0-9]/, 'Include at least one number.');

const callback = (next: string) => `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`;

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const next = safeNext(form.get('next'));
  const parsed = z.object({ email, password: z.string().min(1, 'Enter your password.') })
    .safeParse({ email: form.get('email'), password: form.get('password') });
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: String(form.get('email') ?? '') };
  const tooMany = await limited();
  if (tooMany) return { error: tooMany, email: parsed.data.email };

  const db = await userClient();
  const { error } = await db.auth.signInWithPassword(parsed.data);
  if (error) {
    // Same message for unknown email and wrong password: no account enumeration.
    const msg = error.code === 'email_not_confirmed'
      ? 'Confirm your email first. We sent you a link when you signed up.'
      : 'Email or password is incorrect.';
    return { error: msg, email: parsed.data.email };
  }
  redirect(next);
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z.object({ email, password }).safeParse({ email: form.get('email'), password: form.get('password') });
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: String(form.get('email') ?? '') };
  if (form.get('terms') !== 'on') return { error: 'Accept the Terms and Privacy Policy to continue.', email: parsed.data.email };
  if (isBot(form)) return { message: `Check ${parsed.data.email} for a link to confirm your account.` };
  const tooMany = await limited();
  if (tooMany) return { error: tooMany, email: parsed.data.email };

  const db = await userClient();
  const { error } = await db.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: callback('/auth/confirmed') },
  });
  if (error && error.code !== 'user_already_exists') {
    return { error: error.code === 'weak_password' ? 'That password is too common. Pick another.' : 'Could not create the account. Try again.', email: parsed.data.email };
  }
  // Identical response whether or not the address is already registered.
  return { message: `Check ${parsed.data.email} for a link to confirm your account.` };
}

/**
 * The "Confirm my email" button. The email links to a page on this site (/auth/confirm)
 * instead of using up the one-time token on a plain GET, so mail scanners that pre-open
 * links can't burn it, and it works in whichever browser or app opens the link.
 */
export async function confirmEmail(form: FormData) {
  const tokenHash = String(form.get('token_hash') ?? '');
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(tokenHash)) redirect('/auth/sign-in?error=link');
  const db = await userClient();
  const { error } = await db.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
  if (error) redirect('/auth/sign-in?error=link');
  redirect('/auth/confirmed');
}

export async function sendMagicLink(_: AuthState, form: FormData): Promise<AuthState> {
  const next = safeNext(form.get('next'));
  const parsed = email.safeParse(form.get('email'));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (isBot(form)) return { message: `If ${parsed.data} has an account, a sign-in link is on its way.` };
  const tooMany = await limited();
  if (tooMany) return { error: tooMany, email: parsed.data };
  const db = await userClient();
  await db.auth.signInWithOtp({ email: parsed.data, options: { emailRedirectTo: callback(next), shouldCreateUser: false } });
  return { message: `If ${parsed.data} has an account, a sign-in link is on its way.` };
}

export async function oauth(form: FormData) {
  const provider = z.enum(['github', 'google']).parse(form.get('provider'));
  const next = safeNext(form.get('next'));
  const db = await userClient();
  const { data, error } = await db.auth.signInWithOAuth({ provider, options: { redirectTo: callback(next) } });
  if (error || !data.url) redirect(`/auth/sign-in?error=oauth&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}

export async function requestPasswordReset(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = email.safeParse(form.get('email'));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (isBot(form)) return { message: `If ${parsed.data} has an account, a reset link is on its way.` };
  const tooMany = await limited();
  if (tooMany) return { error: tooMany };
  const db = await userClient();
  await db.auth.resetPasswordForEmail(parsed.data, { redirectTo: callback('/auth/update-password') });
  return { message: `If ${parsed.data} has an account, a reset link is on its way.` };
}

export async function updatePassword(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = password.safeParse(form.get('password'));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (form.get('password') !== form.get('confirm')) return { error: 'The passwords do not match.' };
  const db = await userClient();
  const { error } = await db.auth.updateUser({ password: parsed.data });
  if (error) return { error: error.code === 'same_password' ? 'Choose a password you have not used here before.' : 'Your reset link has expired. Request a new one.' };
  redirect('/dashboard');
}

export async function signOut() {
  const db = await userClient();
  await db.auth.signOut();
  redirect('/');
}
