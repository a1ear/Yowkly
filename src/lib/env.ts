// Public values are inlined into the browser bundle by Next, so they must be
// read with literal `process.env.NEXT_PUBLIC_*` expressions.
//
// Deliberately no zod here: this file ships to every visitor, and zod would add
// ~88 KB (gzipped) of JavaScript to every page. Server-only settings are still
// validated with zod in env.server.ts.

function url(name: string, value: string | undefined) {
  try {
    return new URL(value ?? '').toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be a valid URL (see .env.example).`);
  }
}

function required(name: string, value: string | undefined, min = 1) {
  if (!value || value.length < min) throw new Error(`${name} is not set (see .env.example).`);
  return value;
}

function email(name: string, value: string | undefined) {
  if (!value) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`${name} must be an email address.`);
  return value;
}

export const publicEnv = {
  NEXT_PUBLIC_SITE_URL: url('NEXT_PUBLIC_SITE_URL', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: url('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 20),
  // Public base URL of the R2 media bucket (r2.dev URL or a custom domain like https://media.yowkly.com).
  NEXT_PUBLIC_MEDIA_URL: url('NEXT_PUBLIC_MEDIA_URL', process.env.NEXT_PUBLIC_MEDIA_URL ?? 'http://localhost:3000/media-not-configured'),
  // Where people reach you about privacy, copyright and account questions (shown on the legal pages).
  NEXT_PUBLIC_CONTACT_EMAIL: email('NEXT_PUBLIC_CONTACT_EMAIL', process.env.NEXT_PUBLIC_CONTACT_EMAIL || undefined),
} as const;
