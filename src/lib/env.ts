import { z } from 'zod';

// Public values are inlined into the browser bundle by Next, so they must be
// read with literal `process.env.NEXT_PUBLIC_*` expressions.
const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  // Public base URL of the R2 media bucket (r2.dev URL or a custom domain like https://media.yowkly.com).
  NEXT_PUBLIC_MEDIA_URL: z.url(),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_MEDIA_URL: process.env.NEXT_PUBLIC_MEDIA_URL ?? 'http://localhost:3000/media-not-configured',
});
