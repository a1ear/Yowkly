// Yowkly scan worker.
// Claims queued uploads, checks them, and promotes clean files from the private
// R2 quarantine bucket to the private R2 files bucket. Nothing is downloadable
// until this worker marks it clean. Rejected files are deleted from quarantine.
//
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required (claim/complete RPCs are service-only)
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   required
//   R2_BUCKET_QUARANTINE, R2_BUCKET_FILES     default yowkly-quarantine / yowkly-files
//   CLAMD_HOST, CLAMD_PORT (3310)             required in production
//   ALLOW_NO_ANTIVIRUS=1                      local dev only: structural checks without ClamAV
//
// Run: node worker/scan.mjs            (loop)
//      node worker/scan.mjs --once     (drain the queue once, for tests/cron)
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import net from 'node:net';
import { AwsClient } from 'aws4fetch';
import { inspectZip, magicOk, ZIP_BASED } from './checks.mjs';

const env = process.env;
const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const production = env.NODE_ENV === 'production';
const antivirus = Boolean(env.CLAMD_HOST);
if (!antivirus && (production || env.ALLOW_NO_ANTIVIRUS !== '1')) {
  throw new Error('CLAMD_HOST is not set. Refusing to mark files clean without an antivirus scan (set ALLOW_NO_ANTIVIRUS=1 for local dev only).');
}
if (!antivirus) console.warn('[scan] WARNING: running WITHOUT ClamAV (local dev). Structural checks only.');

const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required');
const r2 = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
const BUCKET = { quarantine: env.R2_BUCKET_QUARANTINE || 'yowkly-quarantine', files: env.R2_BUCKET_FILES || 'yowkly-files' };
const r2url = (bucket, key) => `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${key}`;
const removeFromQuarantine = (key) => r2.fetch(r2url(BUCKET.quarantine, key), { method: 'DELETE' }).catch(() => {});

/** clamd INSTREAM: <len:uint32be><bytes>... <0:uint32be>. clamd.conf must allow StreamMaxLength >= 210M. */
function clamScan(file) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: env.CLAMD_HOST, port: Number(env.CLAMD_PORT ?? 3310) });
    let reply = '';
    sock.setTimeout(5 * 60 * 1000, () => sock.destroy(new Error('clamd timeout')));
    sock.on('error', reject);
    sock.on('data', (d) => (reply += d.toString()));
    sock.on('end', () => {
      const r = reply.replace(/\0/g, '').trim();
      if (/: OK$/.test(r)) resolve({ clean: true, raw: r });
      else if (/FOUND$/.test(r)) resolve({ clean: false, raw: r, signature: r.replace(/^stream: /, '').replace(/ FOUND$/, '') });
      else reject(new Error(`clamd: ${r}`));
    });
    sock.on('connect', async () => {
      sock.write('zINSTREAM\0');
      for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        if (!sock.write(Buffer.concat([len, chunk]))) await new Promise((r) => sock.once('drain', r));
      }
      sock.write(Buffer.alloc(4));
    });
  });
}

async function sha256(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

const safeName = (n) => n.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'file';

async function processJob(job) {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), 'scan-'));
  const file = join(dir, 'upload');
  const report = { antivirus: antivirus ? 'clamav' : 'skipped (dev)', checks: [] };
  const finish = async (status, extra = {}) => {
    const r = await db.rpc('complete_scan', {
      p_file: job.id, p_status: status, p_new_path: extra.path ?? null, p_sha256: extra.sha ?? null,
      p_manifest: extra.manifest ?? null, p_report: { ...report, ms: Date.now() - started }, p_reject_reason: extra.reason ?? null,
    });
    // Rejected or infected bytes never stay around.
    if (status !== 'clean' && !r.error) await removeFromQuarantine(job.storage_path);
    return r;
  };
  try {
    const res = await r2.fetch(r2url(BUCKET.quarantine, job.storage_path));
    if (res.status === 404) return finish('rejected', { reason: 'The upload never finished. Upload the file again.' });
    if (!res.ok || !res.body) throw new Error(`download: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file));

    // The upload URL was signed for exactly this size; anything else is tampering or a broken upload.
    const { size } = await stat(file);
    if (size !== Number(job.size_bytes)) return finish('rejected', { reason: 'The uploaded file size did not match. Upload it again.' });

    const fh = await open(file, 'r');
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    await fh.close();
    report.checks.push('magic');
    if (!magicOk(job.ext, head)) {
      return finish('rejected', { reason: `This doesn't look like a real .${job.ext} file.` });
    }

    let manifest = null;
    const isZip = ZIP_BASED.has(job.ext) || (job.ext === 'fig' && head[0] === 0x50);
    if (isZip) {
      report.checks.push('archive');
      const z = await inspectZip(file);
      if (!z.ok) return finish('rejected', { reason: z.reason });
      if (job.ext === 'zip') manifest = z.manifest;
    }

    if (antivirus) {
      report.checks.push('clamav');
      const av = await clamScan(file);
      report.clamav = av.raw;
      if (!av.clean) return finish('infected', { reason: `Malware detected (${av.signature}). The file was deleted.` });
    }

    const sha = await sha256(file);
    const owner = job.storage_path.split('/')[0];
    const [, tpl, ver] = job.storage_path.split('/');
    const dest = `${owner}/${tpl}/${ver}/${job.id}-${safeName(job.original_name)}`;
    // Server-side copy within the R2 account; fall back to re-uploading the bytes we already hold.
    let copied = await r2.fetch(r2url(BUCKET.files, dest), {
      method: 'PUT', headers: { 'x-amz-copy-source': `/${BUCKET.quarantine}/${job.storage_path}` },
    });
    if (!copied.ok) {
      copied = await r2.fetch(r2url(BUCKET.files, dest), {
        method: 'PUT', body: await readFile(file), headers: { 'content-type': 'application/octet-stream' },
      });
    }
    if (!copied.ok) throw new Error(`promote: HTTP ${copied.status}`);
    const done = await finish('clean', { path: dest, sha, manifest });
    if (done.error) throw new Error(`complete: ${done.error.message}`);
    await removeFromQuarantine(job.storage_path);
    console.log(`[scan] clean ${job.id} ${job.original_name} (${Date.now() - started} ms)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function tick() {
  const { data: jobs, error } = await db.rpc('claim_scan_jobs', { p_limit: 2 });
  if (error) throw new Error(`claim: ${error.message}`);
  for (const job of jobs ?? []) {
    try {
      await processJob(job);
    } catch (e) {
      // Leave it in "scanning": claim_scan_jobs retries after 15 min, up to 3 attempts.
      console.error(`[scan] error ${job.id}:`, e.message);
    }
  }
  return (jobs ?? []).length;
}

const once = process.argv.includes('--once');
let running = true;
process.on('SIGTERM', () => (running = false));
process.on('SIGINT', () => (running = false));
console.log(`[scan] worker started (${antivirus ? 'ClamAV' : 'no antivirus, dev'})`);
while (running) {
  let n = 0;
  try { n = await tick(); } catch (e) { console.error('[scan]', e.message); }
  if (once && n === 0) break;
  if (n === 0) await new Promise((r) => setTimeout(r, 3000));
}
