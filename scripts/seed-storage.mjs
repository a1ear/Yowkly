// LOCAL DEV ONLY: uploads small placeholder files to the storage paths that
// supabase/seed.sql points at, so demo downloads actually work.
// Run after `npm run db:reset`:  npm run seed:storage
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local)');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`Refusing to seed a non-local Supabase (${url})`);

const db = createClient(url, key, { auth: { persistSession: false } });
const { data: files, error } = await db.from('template_files').select('storage_path, original_name').like('storage_path', 'seed/%');
if (error) throw error;
for (const f of files) {
  const body = new Blob([`Yowkly demo placeholder for ${f.original_name}. Not the real file.\n`], { type: 'text/plain' });
  const { error: e } = await db.storage.from('template-files').upload(f.storage_path, body, { upsert: true, contentType: 'application/octet-stream' });
  console.log(e ? `✖ ${f.storage_path}: ${e.message}` : `✔ ${f.storage_path}`);
}
