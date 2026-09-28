// LOCAL DEV ONLY: uploads small placeholder files to the R2 keys that
// supabase/seed.sql points at, so demo downloads actually work.
// Use a separate dev bucket (e.g. yowkly-files-dev), never the production one.
// Run after `npm run db:reset`:  npm run seed:storage
import { createClient } from '@supabase/supabase-js';
import { AwsClient } from 'aws4fetch';

const env = process.env;
const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local)');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`Refusing to seed a non-local Supabase (${url})`);
if ((!env.R2_ACCOUNT_ID && !env.R2_ENDPOINT) || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw new Error('Set the R2_* variables (see .env.example)');
const endpoint = (env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/$/, '');
const localStorage = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(endpoint + '/');
const bucket = env.R2_BUCKET_FILES || 'yowkly-files';
if (!localStorage && !/dev|test|local/.test(bucket)) throw new Error(`Refusing to seed "${bucket}": use a dev bucket name containing dev, test or local`);

const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r2 = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: env.R2_REGION || 'auto' });
const { data: files, error } = await db.from('template_files').select('storage_path, original_name').like('storage_path', 'seed/%');
if (error) throw error;
for (const f of files) {
  const res = await r2.fetch(`${endpoint}/${bucket}/${f.storage_path}`, {
    method: 'PUT',
    body: `Yowkly demo placeholder for ${f.original_name}. Not the real file.\n`,
    headers: { 'content-type': 'application/octet-stream' },
  });
  console.log(res.ok ? `✔ ${f.storage_path}` : `✖ ${f.storage_path}: HTTP ${res.status}`);
}
