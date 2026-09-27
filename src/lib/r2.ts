import 'server-only';
import { AwsClient } from 'aws4fetch';
import { serverEnv } from '@/lib/env.server';

// Cloudflare R2 through its S3-compatible API. The database stores logical
// bucket names; this is the only place that knows the real ones.
export type LogicalBucket = 'quarantine' | 'template-files' | 'media';

const REAL: Record<LogicalBucket, string> = {
  quarantine: serverEnv.R2_BUCKET_QUARANTINE,
  'template-files': serverEnv.R2_BUCKET_FILES,
  media: serverEnv.R2_BUCKET_MEDIA,
};

let client: AwsClient | null = null;
function r2() {
  if (!serverEnv.R2_ACCOUNT_ID || !serverEnv.R2_ACCESS_KEY_ID || !serverEnv.R2_SECRET_ACCESS_KEY) {
    throw new Error('File storage is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).');
  }
  client ??= new AwsClient({
    accessKeyId: serverEnv.R2_ACCESS_KEY_ID,
    secretAccessKey: serverEnv.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  return client;
}

function objectUrl(bucket: LogicalBucket, key: string) {
  if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('Invalid object key');
  return new URL(`https://${serverEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${REAL[bucket]}/${key}`);
}

/**
 * Pre-signed PUT. Content-Type and Content-Length are part of the signature, so
 * the browser must upload exactly the size and type the database approved.
 */
export async function presignUpload(bucket: LogicalBucket, key: string, opts: { contentType: string; size: number; expiresIn?: number }) {
  const url = objectUrl(bucket, key);
  url.searchParams.set('X-Amz-Expires', String(opts.expiresIn ?? 900));
  const signed = await r2().sign(url, {
    method: 'PUT',
    headers: { 'content-type': opts.contentType, 'content-length': String(opts.size) },
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

/** Pre-signed GET that forces a download with a clean filename. */
export async function presignDownload(bucket: LogicalBucket, key: string, filename: string, expiresIn = 60) {
  const url = objectUrl(bucket, key);
  url.searchParams.set('X-Amz-Expires', String(expiresIn));
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 150) || 'download';
  url.searchParams.set('response-content-disposition', `attachment; filename="${safe}"`);
  const signed = await r2().sign(url, { method: 'GET', aws: { signQuery: true } });
  return signed.url;
}

export async function deleteObjects(objects: { bucket: string; storage_path: string }[]) {
  await Promise.all(objects.map(async (o) => {
    if (!(o.bucket in REAL)) return;
    const res = await r2().fetch(objectUrl(o.bucket as LogicalBucket, o.storage_path), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) console.error('[r2] delete failed', o.bucket, o.storage_path, res.status);
  }));
}

/** Direct PUT host for the browser (used in the CSP connect-src). */
export const r2UploadOrigin = () => `https://${serverEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
