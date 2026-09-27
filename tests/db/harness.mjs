// In-process Postgres (PGlite) with a minimal stand-in for the parts of Supabase
// our migrations touch: roles, auth.users/auth.uid(), storage.buckets/objects.
// It deliberately reproduces Supabase's permissive defaults (anon/authenticated
// get ALL on new public tables and functions) so the tests prove our migrations
// revoke them. The real stack is still tested with `supabase db reset` in CI.
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SUPABASE_SHIM = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create schema extensions;
  create schema auth;
  create schema storage;
  grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;
  create extension citext schema extensions;
  create extension pg_trgm schema extensions;
  create extension pgcrypto schema extensions;
  set search_path = public, extensions;
  alter database template1 set search_path = public, extensions;

  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, email text unique,
    encrypted_password text, email_confirmed_at timestamptz,
    raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
    created_at timestamptz default now(), updated_at timestamptz default now(),
    confirmation_token text, recovery_token text, email_change_token_new text, email_change text,
    last_sign_in_at timestamptz
  );
  create table auth.identities (
    id uuid primary key default gen_random_uuid(), provider_id text,
    user_id uuid references auth.users on delete cascade, identity_data jsonb, provider text,
    last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create table storage.buckets (
    id text primary key, name text not null, owner uuid, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[],
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text not null, owner uuid, owner_id text, metadata jsonb,
    created_at timestamptz default now(), unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated, service_role;
  create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
    declare _parts text[];
    begin
      _parts := string_to_array(name, '/');
      return _parts[1:array_length(_parts, 1) - 1];
    end
  $$;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`;

export async function createDb({ seed = false } = {}) {
  const db = await PGlite.create({ extensions: { citext, pg_trgm, pgcrypto } });
  await db.exec(SUPABASE_SHIM);
  const dir = join(root, 'supabase', 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await db.exec(await readFile(join(dir, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }
  if (seed) await db.exec(await readFile(join(root, 'supabase', 'seed.sql'), 'utf8'));
  return db;
}

/** Create an auth user (the on_auth_user_created trigger makes the profile). */
export async function createUser(db, { email, verified = true, ageDays = 30, meta = {} }) {
  const { rows } = await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
     values (gen_random_uuid(), $1, case when $2 then now() else null end, $3::jsonb, now() - make_interval(days => $4))
     returning id`,
    [email, verified, JSON.stringify(meta), ageDays],
  );
  return rows[0].id;
}

/**
 * Run statements as a role. uid = null runs as anon. Commits on success,
 * rolls back and returns { error } on failure.
 */
export async function as(db, uid, sql, params = []) {
  const role = uid === 'service' ? 'service_role' : uid ? 'authenticated' : 'anon';
  const claims = uid && uid !== 'service' ? { sub: uid, role } : { role };
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await tx.query(`set local role ${role}`);
      const res = await tx.query(sql, params);
      return { rows: res.rows, affected: res.affectedRows ?? 0 };
    });
  } catch (error) {
    return { error };
  }
}
