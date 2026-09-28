-- Scan queue reliability.
--
-- 1. Files never stay "Scanning" forever. A file whose scan crashed 3 times is
--    marked rejected ("upload it again") and its owner is notified, instead of
--    silently waiting. Each worker run cleans these up as it claims jobs.
-- 2. scan_queue_size() lets the GitHub workflow skip the expensive part
--    (building ClamAV, downloading signatures) when there's nothing to scan.

create or replace function public.claim_scan_jobs(p_limit int default 1)
returns table (id uuid, storage_path text, ext text, original_name text, size_bytes bigint)
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Give up on files that crashed the scanner 3 times (last try > 15 min ago).
  for r in
    update public.template_files f
       set scan_status = 'rejected', scanned_at = now(),
           reject_reason = 'We couldn''t scan this file. Please upload it again.'
     where f.scan_status = 'scanning' and f.scan_attempts >= 3
       and f.scan_started_at < now() - interval '15 minutes'
    returning f.owner_id, f.template_id, f.original_name
  loop
    perform public.notify(r.owner_id, 'scan_failed', null, r.template_id, null,
                          jsonb_build_object('file', r.original_name, 'reason', 'We couldn''t scan this file. Please upload it again.'));
  end loop;

  return query
  with next as (
    select f.id from public.template_files f
     where (f.scan_status = 'pending'
            or (f.scan_status = 'scanning' and f.scan_started_at < now() - interval '15 minutes'))
       and f.scan_attempts < 3
     order by f.created_at
     limit greatest(1, least(p_limit, 10))
     for update skip locked
  )
  update public.template_files f
     set scan_status = 'scanning', scan_started_at = now(), scan_attempts = f.scan_attempts + 1
    from next where f.id = next.id
  returning f.id, f.storage_path, f.ext, f.original_name, f.size_bytes;
end $$;

-- How many files a worker run would pick up (including ones due for a retry
-- or for being given up on). Service role only.
create function public.scan_queue_size() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.template_files f
   where f.scan_status = 'pending'
      or (f.scan_status = 'scanning' and f.scan_started_at < now() - interval '15 minutes');
$$;

revoke execute on function public.scan_queue_size() from public, anon, authenticated;
grant execute on function public.scan_queue_size() to service_role;

-- Files that burned their attempts while the scanner was misconfigured get a fresh start.
update public.template_files
   set scan_status = 'pending', scan_attempts = 0, scan_started_at = null
 where scan_status in ('pending', 'scanning') and scan_attempts >= 3;
