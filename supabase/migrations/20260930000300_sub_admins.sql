-- Sub-admins (role 'reviewer') and review notifications.
--
-- * An admin can make one of their followers a sub-admin, and take it away again.
-- * Sub-admins see the review queue and may approve or request changes. They
--   cannot remove or restore templates, handle reports, read the audit log or
--   grant roles: those stay with moderators and admins.
-- * When an upload goes to review, every admin, moderator and sub-admin gets a
--   'review_needed' notification.

create function public.is_reviewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('reviewer', 'moderator', 'admin')
  );
$$;

-- The caller's strongest staff role, for the header: 'admin', 'moderator', 'reviewer' or null.
create function public.my_staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when public.has_role('admin') then 'admin'
    when public.has_role('moderator') then 'moderator'
    when public.has_role('reviewer') then 'reviewer'
  end;
$$;

-- ═══════════════════════════════════════════════════════════════ what sub-admins can see
-- Only what is waiting for review (plus the versions, files and images that belong to it).
create policy "templates: reviewers see the queue" on public.templates for select to authenticated
  using (status = 'pending_review' and (select public.is_reviewer()));
create policy "versions: reviewers see the queue" on public.template_versions for select to authenticated
  using ((select public.is_reviewer())
         and exists (select 1 from public.templates t where t.id = template_id and t.status = 'pending_review'));
create policy "files: reviewers see the queue" on public.template_files for select to authenticated
  using ((select public.is_reviewer())
         and exists (select 1 from public.templates t where t.id = template_id and t.status = 'pending_review'));

-- ═══════════════════════════════════════════════════════════════ moderation
-- Same as before, except that sub-admins may approve and reject; remove and restore stay moderator-only.
create or replace function public.moderate_template(p_template uuid, p_action text, p_reason text)
returns public.template_status
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_tpl record;
  v_new public.template_status;
begin
  if p_action in ('approve', 'reject') then
    if not public.is_reviewer() then
      raise exception 'Moderators only' using errcode = '42501';
    end if;
  elsif not public.is_moderator() then
    raise exception 'Moderators only' using errcode = '42501';
  end if;
  select id, owner_id, status into v_tpl from public.templates where id = p_template for update;
  if v_tpl.id is null then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if v_tpl.owner_id = v_uid and not public.is_admin() then
    raise exception 'You can''t review your own upload' using errcode = '42501';
  end if;
  if p_action <> 'approve' and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required' using errcode = '23514';
  end if;

  case p_action
    when 'approve' then
      if v_tpl.status <> 'pending_review' then raise exception 'Not pending review' using errcode = '42501'; end if;
      v_new := 'published';
      update public.templates set status = v_new, status_reason = null, published_at = coalesce(published_at, now())
       where id = p_template;
      -- Two approved templates earns auto-publish.
      update public.profiles set trust_level = greatest(trust_level, 1)
       where id = v_tpl.owner_id and trust_level = 0
         and (select count(*) from public.templates where owner_id = v_tpl.owner_id and published_at is not null) >= 2;
      perform public.notify(v_tpl.owner_id, 'upload_approved', v_uid, p_template);
    when 'reject' then
      if v_tpl.status <> 'pending_review' then raise exception 'Not pending review' using errcode = '42501'; end if;
      v_new := 'draft';
      update public.templates set status = v_new, status_reason = btrim(p_reason) where id = p_template;
      perform public.notify(v_tpl.owner_id, 'upload_rejected', v_uid, p_template, null,
                            jsonb_build_object('reason', btrim(p_reason)));
    when 'remove' then
      if v_tpl.status = 'removed' then raise exception 'Already removed' using errcode = '42501'; end if;
      v_new := 'removed';
      update public.templates set status = v_new, status_reason = btrim(p_reason) where id = p_template;
      perform public.notify(v_tpl.owner_id, 'template_removed', v_uid, p_template, null,
                            jsonb_build_object('reason', btrim(p_reason)));
    when 'restore' then
      if v_tpl.status <> 'removed' then raise exception 'Not removed' using errcode = '42501'; end if;
      v_new := 'published';
      update public.templates set status = v_new, status_reason = null, published_at = coalesce(published_at, now())
       where id = p_template;
    else
      raise exception 'Unknown action %', p_action using errcode = '22023';
  end case;

  -- The review is done: clear the "needs review" pings for everyone on staff.
  update public.notifications set read_at = coalesce(read_at, now())
   where type = 'review_needed' and template_id = p_template;

  insert into public.moderation_log (actor_id, action, target_type, target_id, reason, data)
  values (v_uid, p_action || '_template', 'template', p_template, nullif(btrim(coalesce(p_reason, '')), ''),
          jsonb_build_object('from', v_tpl.status, 'to', v_new));
  return v_new;
end $$;

-- ═══════════════════════════════════════════════════════════════ granting sub-admin
-- Admins only, and only to someone who follows them. Logged.
create function public.set_sub_admin(p_user uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_user = v_uid then
    raise exception 'You are already an admin' using errcode = '22023';
  end if;
  if p_on then
    if not exists (select 1 from public.follows where follower_id = p_user and followee_id = v_uid) then
      raise exception 'Only people who follow you can be made sub-admins' using errcode = '42501';
    end if;
    if exists (select 1 from public.profiles where id = p_user and deleted_at is not null) then
      raise exception 'That account is closed' using errcode = '42501';
    end if;
    insert into public.user_roles (user_id, role, granted_by) values (p_user, 'reviewer', v_uid)
    on conflict do nothing;
  else
    delete from public.user_roles where user_id = p_user and role = 'reviewer';
  end if;
  insert into public.moderation_log (actor_id, action, target_type, target_id)
  values (v_uid, case when p_on then 'grant_sub_admin' else 'revoke_sub_admin' end, 'profile', p_user);
end $$;

-- An admin's followers and current sub-admins, for the Team tab.
create function public.sub_admin_candidates()
returns table (id uuid, username text, display_name text, avatar_path text, is_sub_admin boolean, follows_you boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username::text, p.display_name, p.avatar_path,
         exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'reviewer'),
         exists (select 1 from public.follows f where f.follower_id = p.id and f.followee_id = (select auth.uid()))
    from public.profiles p
   where public.is_admin() and p.deleted_at is null and p.id <> (select auth.uid())
     and (exists (select 1 from public.follows f where f.follower_id = p.id and f.followee_id = (select auth.uid()))
          or exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'reviewer'))
   order by 5 desc, lower(p.display_name)
   limit 500;
$$;

-- ═══════════════════════════════════════════════════════════════ review notifications
create function public.notify_review_needed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending_review' and old.status is distinct from 'pending_review' then
    insert into public.notifications (user_id, type, actor_id, template_id)
    select distinct r.user_id, 'review_needed'::public.notification_type, new.owner_id, new.id
      from public.user_roles r
     where r.role in ('reviewer', 'moderator', 'admin') and r.user_id <> new.owner_id;
  end if;
  return new;
end $$;
create trigger templates_notify_review after update of status on public.templates
  for each row execute function public.notify_review_needed();

revoke execute on function public.notify_review_needed(), public.set_sub_admin(uuid, boolean),
                           public.sub_admin_candidates(), public.my_staff_role(), public.is_reviewer()
  from public, anon, authenticated;
grant execute on function public.set_sub_admin(uuid, boolean), public.sub_admin_candidates(),
                          public.my_staff_role(), public.is_reviewer() to authenticated;
