-- Uploaded bytes move from Supabase Storage to Cloudflare R2 (free egress, no
-- 50 MB cap). Postgres still decides everything:
--   prepare_*_upload  → checks ownership/limits and hands out the ONLY path the
--                       server will sign an upload URL for
--   register_*        → records the upload; the scan worker verifies the real
--                       bytes (size, type, malware) before anything is public
--   delete_draft_*    → owner-checked deletes that return the object keys so the
--                       server can remove them from R2 (no service key needed)
-- Logical bucket names ('quarantine', 'template-files', 'media') stay in the
-- database; the app maps them to real R2 bucket names via environment variables.

-- ── files ─────────────────────────────────────────────────────────────────
create function public.prepare_file_upload(p_version uuid, p_filename text, p_size bigint)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_verified_user();
  v_ver record;
  v_ext text := lower(substring(coalesce(p_filename, '') from '\.([A-Za-z0-9]+)$'));
begin
  select v.id, v.template_id, v.owner_id, v.status into v_ver
    from public.template_versions v where v.id = p_version;
  if v_ver.id is null or v_ver.owner_id <> v_uid then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if v_ver.status <> 'draft' then
    raise exception 'Files can only be added to a draft version' using errcode = '42501';
  end if;
  if v_ext is null or v_ext not in ('zip', 'fig', 'psd', 'ai', 'sketch', 'xd', 'penpot', 'pdf') then
    raise exception 'File type not allowed' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 209715200 then
    raise exception 'Files can be up to 200 MB' using errcode = '22023';
  end if;
  if (select count(*) from public.template_files where version_id = p_version) >= 5 then
    raise exception 'A version can have at most 5 files' using errcode = '54000';
  end if;
  if coalesce((select sum(size_bytes) from public.template_files
                where owner_id = v_uid and scan_status not in ('infected', 'rejected')), 0) + p_size > 1073741824 then
    raise exception 'Storage quota (1 GB) exceeded' using errcode = '54000';
  end if;
  return v_uid::text || '/' || v_ver.template_id::text || '/' || p_version::text || '/' || gen_random_uuid()::text || '.' || v_ext;
end $$;

drop function public.register_file(uuid, text, text);

-- The size is the one the upload URL was signed for (the browser cannot send a
-- different Content-Length); the worker re-checks the stored object anyway.
create function public.register_file(p_version uuid, p_path text, p_original_name text, p_size bigint)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_verified_user();
  v_ver   record;
  v_parts text[] := string_to_array(p_path, '/');
  v_ext   text := lower(substring(p_path from '\.([A-Za-z0-9]+)$'));
  v_id    uuid;
begin
  select v.id, v.template_id, v.owner_id, v.status into v_ver
    from public.template_versions v where v.id = p_version;
  if v_ver.id is null or v_ver.owner_id <> v_uid then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if v_ver.status <> 'draft' then
    raise exception 'Files can only be added to a draft version' using errcode = '42501';
  end if;
  if array_length(v_parts, 1) <> 4 or v_parts[1] <> v_uid::text
     or v_parts[2] <> v_ver.template_id::text or v_parts[3] <> p_version::text
     or v_parts[4] !~ '^[0-9a-f-]{36}\.[a-z0-9]+$' then
    raise exception 'Invalid upload path' using errcode = '22023';
  end if;
  if v_ext is null or v_ext not in ('zip', 'fig', 'psd', 'ai', 'sketch', 'xd', 'penpot', 'pdf') then
    raise exception 'File type not allowed' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 209715200 then
    raise exception 'Files can be up to 200 MB' using errcode = '22023';
  end if;
  if (select count(*) from public.template_files where version_id = p_version) >= 5 then
    raise exception 'A version can have at most 5 files' using errcode = '54000';
  end if;
  if coalesce((select sum(size_bytes) from public.template_files
                where owner_id = v_uid and scan_status not in ('infected', 'rejected')), 0) + p_size > 1073741824 then
    raise exception 'Storage quota (1 GB) exceeded' using errcode = '54000';
  end if;

  insert into public.template_files
    (version_id, template_id, owner_id, bucket, storage_path, original_name, ext, size_bytes, source_tool)
  values
    (p_version, v_ver.template_id, v_uid, 'quarantine', p_path,
     left(regexp_replace(coalesce(p_original_name, 'file.' || v_ext), '[\\/\x00-\x1f]', '_', 'g'), 200),
     v_ext, p_size, public.ext_to_tool(v_ext))
  returning id into v_id;
  return v_id;
end $$;

create function public.delete_draft_file(p_file uuid)
returns table (bucket text, storage_path text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_f   record;
begin
  select f.id, f.bucket, f.storage_path, f.owner_id, v.status as version_status into v_f
    from public.template_files f join public.template_versions v on v.id = f.version_id
   where f.id = p_file;
  if v_f.id is null or v_f.owner_id <> v_uid then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  if v_f.version_status <> 'draft' then
    raise exception 'Files of a published version cannot be removed' using errcode = '42501';
  end if;
  delete from public.template_files where id = p_file;
  return query select v_f.bucket, v_f.storage_path;
end $$;

-- ── media ─────────────────────────────────────────────────────────────────
create function public.prepare_media_upload(p_template uuid, p_content_type text, p_size bigint)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_verified_user();
  v_tpl record;
  v_ext text := case p_content_type
                  when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp'
                  when 'image/avif' then 'avif' when 'image/gif' then 'gif' end;
begin
  select id, owner_id, status into v_tpl from public.templates where id = p_template;
  if v_tpl.id is null or v_tpl.owner_id <> v_uid then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if v_tpl.status = 'removed' then
    raise exception 'This template was removed by a moderator' using errcode = '42501';
  end if;
  if v_ext is null then
    raise exception 'Use a PNG, JPG, WebP, AVIF or GIF image' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then
    raise exception 'Images can be up to 10 MB' using errcode = '22023';
  end if;
  if (select count(*) from public.template_media where template_id = p_template) >= 12 then
    raise exception 'A template can have at most 12 images' using errcode = '54000';
  end if;
  return v_uid::text || '/' || p_template::text || '/' || gen_random_uuid()::text || '.' || v_ext;
end $$;

-- Same checks as before, minus the Supabase Storage lookup (bytes live in R2 now).
create or replace function public.register_media(
  p_template uuid, p_path text, p_kind public.media_kind, p_device public.device_kind,
  p_alt text, p_width int, p_height int
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_verified_user();
  v_tpl record;
  v_id  uuid;
begin
  select id, owner_id, status into v_tpl from public.templates where id = p_template;
  if v_tpl.id is null or v_tpl.owner_id <> v_uid then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if v_tpl.status = 'removed' then
    raise exception 'This template was removed by a moderator' using errcode = '42501';
  end if;
  if p_path !~ ('^' || v_uid::text || '/' || p_template::text || '/[0-9a-f-]{36}\.(png|jpg|webp|avif|gif)$') then
    raise exception 'Invalid media path' using errcode = '22023';
  end if;
  if (select count(*) from public.template_media where template_id = p_template) >= 12 then
    raise exception 'A template can have at most 12 images' using errcode = '54000';
  end if;
  if p_kind = 'cover' then
    delete from public.template_media where template_id = p_template and kind = 'cover';
  end if;
  insert into public.template_media (template_id, owner_id, path, kind, device, alt_text, width, height, sort)
  values (p_template, v_uid, p_path, p_kind, coalesce(p_device, 'desktop'), btrim(p_alt), p_width, p_height,
          coalesce((select max(sort) + 1 from public.template_media where template_id = p_template), 0))
  returning id into v_id;
  return v_id;
end $$;

-- ── whole drafts ──────────────────────────────────────────────────────────
-- Returns every object key the draft owned so the server can delete them from R2.
create function public.delete_draft_template(p_template uuid)
returns table (bucket text, storage_path text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  v_tpl  record;
begin
  select id, owner_id, status, published_at into v_tpl from public.templates where id = p_template;
  if v_tpl.id is null or v_tpl.owner_id <> v_uid then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if v_tpl.status <> 'draft' or v_tpl.published_at is not null then
    raise exception 'Only drafts that were never published can be deleted' using errcode = '42501';
  end if;
  -- The keys CTE reads the snapshot taken before the delete runs.
  return query
  with keys as (
    select f.bucket, f.storage_path from public.template_files f where f.template_id = p_template
    union all
    select 'media'::text, m.path from public.template_media m where m.template_id = p_template
  ), gone as (
    delete from public.templates t where t.id = p_template returning t.id
  )
  select k.bucket, k.storage_path from keys k;
end $$;

revoke execute on function
  public.prepare_file_upload(uuid, text, bigint), public.register_file(uuid, text, text, bigint),
  public.delete_draft_file(uuid), public.prepare_media_upload(uuid, text, bigint),
  public.delete_draft_template(uuid)
from public, anon;

grant execute on function
  public.prepare_file_upload(uuid, text, bigint), public.register_file(uuid, text, text, bigint),
  public.delete_draft_file(uuid), public.prepare_media_upload(uuid, text, bigint),
  public.delete_draft_template(uuid)
to authenticated;
