import 'server-only';
import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production';
const optional = z.string().optional().or(z.literal(''));
// A bucket NAME, not a URL: pasting the bucket's "S3 API" address here doubles the
// R2 host in upload URLs and every upload fails with a misleading CORS error.
const bucket = (fallback: string) => z.string()
  .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'must be just the bucket name (e.g. yowkly-files), not a URL')
  .default(fallback);
// The 32-character hex ID from R2 → Account Details, not the https://….r2.cloudflarestorage.com address.
const accountId = z.string().regex(/^[a-f0-9]{32}$/, 'must be the 32-character Account ID from R2 → Account Details, not a URL');

const serverSchema = z.object({
  // Rate limiting must be real in production; locally an in-memory limiter is used.
  UPSTASH_REDIS_REST_URL: isProd ? z.url() : z.url().optional().or(z.literal('')),
  UPSTASH_REDIS_REST_TOKEN: isProd ? z.string().min(10) : optional,
  // Cloudflare R2 holds every uploaded byte (quarantine, clean files, images).
  R2_ACCOUNT_ID: isProd ? accountId : accountId.optional().or(z.literal('')),
  // Local dev only (points at Supabase's S3 storage). In production the endpoint is
  // built from R2_ACCOUNT_ID, so this must be left unset there.
  R2_ENDPOINT: isProd
    ? z.literal('', { error: 'must not be set in production (delete it; R2_ACCOUNT_ID is enough)' }).optional()
    : z.url().optional().or(z.literal('')),
  R2_REGION: z.string().default('auto'),
  R2_ACCESS_KEY_ID: isProd ? z.string().min(10) : optional,
  R2_SECRET_ACCESS_KEY: isProd ? z.string().min(10) : optional,
  R2_BUCKET_QUARANTINE: bucket('yowkly-quarantine'),
  R2_BUCKET_FILES: bucket('yowkly-files'),
  R2_BUCKET_MEDIA: bucket('yowkly-media'),
  SENTRY_DSN: optional,
  // Starts the GitHub "Scan uploads" workflow as soon as a file is uploaded.
  // Fine-grained token: this repo only, Actions: Read and write. Optional: without
  // it, uploads wait for the hourly scheduled run.
  GITHUB_SCAN_TOKEN: optional,
  GITHUB_SCAN_REPO: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'must look like owner/repo').default('a1ear/Yowkly'),
  GITHUB_SCAN_REF: z.string().default('main'),
});

const parsed = serverSchema.safeParse({
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ENDPOINT: process.env.R2_ENDPOINT,
  R2_REGION: process.env.R2_REGION || undefined,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_QUARANTINE: process.env.R2_BUCKET_QUARANTINE || undefined,
  R2_BUCKET_FILES: process.env.R2_BUCKET_FILES || undefined,
  R2_BUCKET_MEDIA: process.env.R2_BUCKET_MEDIA || undefined,
  SENTRY_DSN: process.env.SENTRY_DSN,
  GITHUB_SCAN_TOKEN: process.env.GITHUB_SCAN_TOKEN,
  GITHUB_SCAN_REPO: process.env.GITHUB_SCAN_REPO || undefined,
  GITHUB_SCAN_REF: process.env.GITHUB_SCAN_REF || undefined,
});
if (!parsed.success) {
  // Name every bad setting at once, e.g. "R2_BUCKET_QUARANTINE: must be just the bucket name".
  throw new Error(`Invalid server environment variables:\n${
    parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
}
export const serverEnv = parsed.data;
