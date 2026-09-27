import 'server-only';
import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production';

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  // Rate limiting must be real in production; locally an in-memory limiter is used.
  UPSTASH_REDIS_REST_URL: isProd ? z.url() : z.url().optional().or(z.literal('')),
  UPSTASH_REDIS_REST_TOKEN: isProd ? z.string().min(10) : z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

export const serverEnv = serverSchema.parse({
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  SENTRY_DSN: process.env.SENTRY_DSN,
});
