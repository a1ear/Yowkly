-- Storage buckets and object policies.
--   quarantine      private  uploads land here; only the scan worker (service role) reads them
--   template-files  private  clean files; reachable only through 60 s signed URLs from begin_download
--   media           public   covers and gallery images (no SVG: it can carry script)
--   avatars         public   profile avatars and banners
-- Paths always start with the owner's user id, which is what the policies check.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('quarantine',     'quarantine',     false, 209715200, null),
  ('template-files', 'template-files', false, 209715200, null),
  ('media',          'media',          true,  10485760,
     array['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']),
  ('avatars',        'avatars',        true,  2097152,
     array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- quarantine: write-only for the owner, into a draft version they own.
create policy "quarantine: owner uploads into own draft" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'quarantine'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.template_versions v
       where v.id::text = (storage.foldername(name))[3]
         and v.template_id::text = (storage.foldername(name))[2]
         and v.owner_id = (select auth.uid())
         and v.status = 'draft'
    )
  );
create policy "quarantine: owner removes own upload" on storage.objects for delete to authenticated
  using (bucket_id = 'quarantine' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No SELECT policy: nobody but the service role can read quarantined bytes.

-- template-files: no client policies at all.

-- media: owner uploads into a template they own; public read comes from the bucket being public.
create policy "media: owner uploads" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.templates t
       where t.id::text = (storage.foldername(name))[2]
         and t.owner_id = (select auth.uid())
         and t.status <> 'removed'
    )
  );
create policy "media: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- avatars
create policy "avatars: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner replaces" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
