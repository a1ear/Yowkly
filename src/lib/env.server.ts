import 'server-only';
import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production';
const optional = z.string().optional().or(z.literal(''));

const serverSchema = z.object({
  // Rate limiting must be real in production; locally an in-memory limiter is used.
  UPSTASH_REDIS_REST_URL: isProd ? z.url() : z.url().optional().or(z.literal('')),
  UPSTASH_REDIS_REST_TOKEN: isProd ? z.string().min(10) : optional,
  // Cloudflare R2 holds every uploaded byte (quarantine, clean files, images).
  R2_ACCOUNT_ID: isProd ? z.string().min(10) : optional,
  R2_ACCESS_KEY_ID: isProd ? z.string().min(10) : optional,
  R2_SECRET_ACCESS_KEY: isProd ? z.string().min(10) : optional,
  R2_BUCKET_QUARANTINE: z.string().default('yowkly-quarantine'),
  R2_BUCKET_FILES: z.string().default('yowkly-files'),
  R2_BUCKET_MEDIA: z.string().default('yowkly-media'),
  SENTRY_DSN: optional,
});

export const serverEnv = serverSchema.parse({
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_QUARANTINE: process.env.R2_BUCKET_QUARANTINE || undefined,
  R2_BUCKET_FILES: process.env.R2_BUCKET_FILES || undefined,
  R2_BUCKET_MEDIA: process.env.R2_BUCKET_MEDIA || undefined,
  SENTRY_DSN: process.env.SENTRY_DSN,
});
