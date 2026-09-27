-- Triggers, guards and RPCs.
-- Every SECURITY DEFINER function pins search_path = '' and fully qualifies names.
-- State transitions (publish, moderate, yank, download) happen only here, so the
-- rules live in one place no matter which client calls them.

-- ═══════════════════════════════════════════════════════════════ role helpers
create function public.has_role(p_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = p_role
  );
$$;

create function public.is_moderator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('moderator', 'admin')
  );
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin');
$$;

create function public.auth_email_verified() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select email_confirmed_at is not null from auth.users where id = (select auth.uid())),
    false
  );
$$;

create function public.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  return v_uid;
end $$;

create function public.require_verified_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.auth_email_verified() then
    raise exception 'Verify your email first' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and deleted_at is not null) then
    raise exception 'Account is deleted' using errcode = '28000';
  end if;
  return v_uid;
end $$;

-- ═══════════════════════════════════════════════════════════════ profiles
create function public.guard_username() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.reserved_usernames r where r.username = new.username) then
    raise exception 'That username is reserved' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger profiles_guard_username
  before insert or update of username on public.profiles
  for each row execute function public.guard_username();

-- New auth user -> profile with a unique, valid username derived from the
-- provider handle or email. The user can change it during onboarding.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_base text;
  v_name text;
  v_try  text;
  v_i    int := 0;
begin
  v_base := coalesce(
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'preferred_username',
    split_part(new.email, '@', 1),
    'user'
  );
  v_base := left(regexp_replace(v_base, '[^A-Za-z0-9_]', '', 'g'), 24);
  if char_length(v_base) < 3 then v_base := 'user' || v_base; end if;

  v_name := coalesce(
    nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 60), ''),
    nullif(left(btrim(new.raw_user_meta_data ->> 'name'), 60), ''),
    v_base
  );

  v_try := v_base;
  while exists (select 1 from public.profiles where username = v_try::extensions.citext)
     or exists (select 1 from public.reserved_usernames where username = v_try::extensions.citext) loop
    v_i := v_i + 1;
    v_try := left(v_base, 24) || '_' || substr(md5(random()::text), 1, 4);
    if v_i > 20 then raise exception 'Could not allocate a username'; end if;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_try, v_name);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════ ownership denormalisation
-- Child rows copy owner_id from their parent. Whatever the client sent is overwritten.
create function public.set_owner_from_template() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select t.owner_id into new.owner_id from public.templates t where t.id = new.template_id;
  if new.owner_id is null then
    raise exception 'Template not found' using errcode = '23503';
  end if;
  return new;
end $$;

create trigger template_tags_owner     before insert on public.template_tags     for each row execute function public.set_owner_from_template();
create trigger template_links_owner    before insert on public.template_links    for each row execute function public.set_owner_from_template();
create trigger template_versions_owner before insert on public.template_versions for each row execute function public.set_owner_from_template();
create trigger template_files_owner    before insert on public.template_files    for each row execute function public.set_owner_from_template();
create trigger template_media_owner    before insert on public.template_media    for each row execute function public.set_owner_from_template();

create function public.set_owner_from_collection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select c.owner_id into new.owner_id from public.collections c where c.id = new.collection_id;
  if new.owner_id is null then
    raise exception 'Collection not found' using errcode = '23503';
  end if;
  return new;
end $$;

create trigger collection_items_owner before insert on public.collection_items
  for each row execute function public.set_owner_from_collection();

-- Links may not change template or owner after insert.
create function public.guard_link_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.template_id <> old.template_id or new.owner_id <> old.owner_id then
    raise exception 'Cannot move a link' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger template_links_guard before update on public.template_links
  for each row execute function public.guard_link_update();

-- ═══════════════════════════════════════════════════════════════ templates
create function public.create_template_stats() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.template_stats (template_id) values (new.id);
  return new;
end $$;
create trigger templates_stats after insert on public.templates
  for each row execute function public.create_template_stats();

create function public.limit_template_tags() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.template_tags where template_id = new.template_id) >= 10 then
    raise exception 'A template can have at most 10 tags' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger template_tags_limit before insert on public.template_tags
  for each row execute function public.limit_template_tags();

-- Cover path is derived from template_media so list queries need no join.
create function public.sync_cover_path() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tpl uuid := coalesce(new.template_id, old.template_id);
begin
  update public.templates t
     set cover_path = (select m.path from public.template_media m
                        where m.template_id = v_tpl and m.kind = 'cover' limit 1)
   where t.id = v_tpl;
  return null;
end $$;
create trigger template_media_cover after insert or update or delete on public.template_media
  for each row execute function public.sync_cover_path();

-- ═══════════════════════════════════════════════════════════════ versions: never rewrite history
create function public.guard_version_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.template_id <> old.template_id or new.owner_id <> old.owner_id or new.created_at <> old.created_at then
    raise exception 'Version identity is immutable' using errcode = '42501';
  end if;
  if old.status = 'draft' then
    return new;
  end if;
  -- Published or yanked: only published -> yanked is allowed, and only the status fields move.
  if old.status = 'published' and new.status = 'yanked'
     and new.version = old.version
     and new.changelog is not distinct from old.changelog
     and new.license_code is not distinct from old.license_code
     and new.published_at = old.published_at
     and new.rights_attested_at = old.rights_attested_at then
    return new;
  end if;
  raise exception 'Published versions are immutable. Publish a new version instead.' using errcode = '42501';
end $$;
create trigger template_versions_guard before update on public.template_versions
  for each row execute function public.guard_version_update();

create function public.guard_version_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Cascades from a deleted template (or purged account) are allowed.
  if old.status <> 'draft' and exists (select 1 from public.templates where id = old.template_id) then
    raise exception 'Published versions cannot be deleted' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger template_versions_guard_delete before delete on public.template_versions
  for each row execute function public.guard_version_delete();

-- Files belong to a draft version; once the version is published they are frozen
-- (the scan pipeline updates scan fields through complete_scan only).
create function public.guard_file_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.template_versions v where v.id = old.version_id and v.status <> 'draft') then
    raise exception 'Files of a published version cannot be deleted' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger template_files_guard_delete before delete on public.template_files
  for each row execute function public.guard_file_delete();

-- ═══════════════════════════════════════════════════════════════ append-only tables
create function public.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

-- moderation_log: the only permitted update is the FK cascade nulling actor_id.
create function public.guard_moderation_log() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.actor_id is null and old.actor_id is not null
     and (new.id, new.action, new.target_type, new.target_id, new.reason, new.data, new.created_at)
         is not distinct from
         (old.id, old.action, old.target_type, old.target_id, old.reason, old.data, old.created_at) then
    return new;
  end if;
  raise exception 'moderation_log is append-only' using errcode = '42501';
end $$;
create trigger moderation_log_no_update before update on public.moderation_log
  for each row execute function public.guard_moderation_log();
create trigger moderation_log_no_delete before delete on public.moderation_log
  for each row execute function public.forbid_change();

-- downloads: only FK cascades that null user/version/file are allowed.
create function public.guard_downloads() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.template_id, new.link_kind, new.license_code, new.created_at)
       is not distinct from (old.id, old.template_id, old.link_kind, old.license_code, old.created_at)
     and (new.user_id is null or new.user_id = old.user_id)
     and (new.version_id is null or new.version_id = old.version_id)
     and (new.file_id is null or new.file_id = old.file_id) then
    return new;
  end if;
  raise exception 'downloads is append-only' using errcode = '42501';
end $$;
create trigger downloads_guard before update on public.downloads
  for each row execute function public.guard_downloads();

-- awards: immutable except the editorial blurb.
create function public.guard_awards() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.template_id, new.period, new.period_start, new.category_id,
      new.score_snapshot, new.vote_count_snapshot, new.created_at)
     is not distinct from
     (old.id, old.template_id, old.period, old.period_start, old.category_id,
      old.score_snapshot, old.vote_count_snapshot, old.created_at) then
    return new;
  end if;
  raise exception 'Awards are immutable' using errcode = '42501';
end $$;
create trigger awards_guard before update on public.awards
  for each row execute function public.guard_awards();

-- ═══════════════════════════════════════════════════════════════ notifications helper
create function public.notify(
  p_user uuid, p_type public.notification_type, p_actor uuid,
  p_template uuid default null, p_comment uuid default null, p_data jsonb default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  insert into public.notifications (user_id, type, actor_id, template_id, comment_id, data)
  values (p_user, p_type, p_actor, p_template, p_comment, coalesce(p_data, '{}'));
end $$;

-- ═══════════════════════════════════════════════════════════════ likes
create function public.on_like_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
  v_owner uuid;
begin
  if tg_op = 'INSERT' then
    update public.template_stats set like_count = like_count + 1, updated_at = now()
     where template_id = new.template_id returning like_count into v_count;
    if v_count in (10, 50, 100, 250, 500, 1000, 2500, 5000, 10000) then
      select owner_id into v_owner from public.templates where id = new.template_id;
      perform public.notify(v_owner, 'like_milestone', null, new.template_id, null,
                            jsonb_build_object('count', v_count));
    end if;
  else
    update public.template_stats set like_count = greatest(like_count - 1, 0), updated_at = now()
     where template_id = old.template_id;
  end if;
  return null;
end $$;
create trigger likes_stats after insert or delete on public.likes
  for each row execute function public.on_like_change();

create function public.limit_like_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.likes
       where user_id = new.user_id and created_at > now() - interval '10 minutes') >= 60 then
    raise exception 'Too many likes. Try again in a few minutes.' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger likes_rate before insert on public.likes
  for each row execute function public.limit_like_rate();

-- ═══════════════════════════════════════════════════════════════ votes
create function public.template_has_code(p_template uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.template_files f
        join public.templates t on t.current_version_id = f.version_id
       where t.id = p_template and f.source_tool = 'code' and f.scan_status = 'clean')
      or exists (select 1 from public.template_links l where l.template_id = p_template and l.kind = 'github');
$$;

-- Returns 'ok' or the reason the current user may not vote. Used by RLS and the UI.
create function public.vote_eligibility(p_template uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_created timestamptz;
  v_owner   uuid;
  v_status  public.template_status;
begin
  if v_uid is null then return 'auth'; end if;
  select owner_id, status into v_owner, v_status from public.templates where id = p_template;
  if v_owner is null or v_status <> 'published' then return 'not_published'; end if;
  if v_owner = v_uid then return 'own'; end if;
  if not public.auth_email_verified() then return 'unverified'; end if;
  select created_at into v_created from auth.users where id = v_uid;
  if v_created > now() - interval '7 days' then return 'too_new'; end if;
  return 'ok';
end $$;

create function public.before_vote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.template_id <> old.template_id) then
    raise exception 'Cannot move a vote' using errcode = '42501';
  end if;
  if new.code_quality is not null and not public.template_has_code(new.template_id) then
    raise exception 'Code quality applies to code templates only' using errcode = '23514';
  end if;
  new.weight := case when exists (select 1 from public.user_roles
                                   where user_id = new.user_id and role = 'juror') then 3.0 else 1.0 end;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.updated_at := now();
  else
    if (select count(*) from public.votes
         where user_id = new.user_id and created_at > now() - interval '1 hour') >= 30 then
      raise exception 'Too many votes. Try again later.' using errcode = '54000';
    end if;
  end if;
  return new;
end $$;
create trigger votes_before before insert or update on public.votes
  for each row execute function public.before_vote();

create function public.on_vote_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.template_stats set
      vote_count      = vote_count - 1,
      weight_sum      = weight_sum - old.weight,
      score_sum       = score_sum - old.score * old.weight,
      design_sum      = design_sum - old.design * old.weight,
      usability_sum   = usability_sum - old.usability * old.weight,
      creativity_sum  = creativity_sum - old.creativity * old.weight,
      code_sum        = code_sum - coalesce(old.code_quality, 0) * old.weight,
      code_weight_sum = code_weight_sum - case when old.code_quality is null then 0 else old.weight end,
      updated_at      = now()
    where template_id = old.template_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.template_stats set
      vote_count      = vote_count + 1,
      weight_sum      = weight_sum + new.weight,
      score_sum       = score_sum + new.score * new.weight,
      design_sum      = design_sum + new.design * new.weight,
      usability_sum   = usability_sum + new.usability * new.weight,
      creativity_sum  = creativity_sum + new.creativity * new.weight,
      code_sum        = code_sum + coalesce(new.code_quality, 0) * new.weight,
      code_weight_sum = code_weight_sum + case when new.code_quality is null then 0 else new.weight end,
      updated_at      = now()
    where template_id = new.template_id;
  end if;
  return null;
end $$;
create trigger votes_stats after insert or update or delete on public.votes
  for each row execute function public.on_vote_change();

-- ═══════════════════════════════════════════════════════════════ follows, saves
create function public.on_follow() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify(new.followee_id, 'follow', new.follower_id);
  return null;
end $$;
create trigger follows_notify after insert on public.follows
  for each row execute function public.on_follow();

create function public.on_collection_item_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.template_stats set save_count = save_count + 1 where template_id = new.template_id;
  else
    update public.template_stats set save_count = greatest(save_count - 1, 0) where template_id = old.template_id;
  end if;
  return null;
end $$;
create trigger collection_items_stats after insert or delete on public.collection_items
  for each row execute function public.on_collection_item_change();

-- ═══════════════════════════════════════════════════════════════ comments
create function public.before_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_parent record;
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      select template_id, parent_id into v_parent from public.comments where id = new.parent_id;
      if v_parent.template_id is distinct from new.template_id then
        raise exception 'Reply must belong to the same template' using errcode = '23514';
      end if;
      if v_parent.parent_id is not null then
        raise exception 'Replies are one level deep' using errcode = '23514';
      end if;
    end if;
    if (select count(*) from public.comments
         where author_id = new.author_id and created_at > now() - interval '10 minutes') >= 10 then
      raise exception 'You are commenting too fast. Try again in a few minutes.' using errcode = '54000';
    end if;
    new.deleted_at := null;
  else
    if new.template_id <> old.template_id or new.author_id is distinct from old.author_id
       or new.parent_id is distinct from old.parent_id or new.created_at <> old.created_at then
      raise exception 'Only the comment body can change' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger comments_before before insert or update on public.comments
  for each row execute function public.before_comment();

create function public.on_comment_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner  uuid;
  v_parent uuid;
begin
  update public.template_stats set comment_count = comment_count + 1 where template_id = new.template_id;
  select owner_id into v_owner from public.templates where id = new.template_id;
  if new.parent_id is not null then
    select author_id into v_parent from public.comments where id = new.parent_id;
    perform public.notify(v_parent, 'reply', new.author_id, new.template_id, new.id);
  end if;
  if v_owner is distinct from v_parent then
    perform public.notify(v_owner, 'comment', new.author_id, new.template_id, new.id);
  end if;
  return null;
end $$;
create trigger comments_after_insert after insert on public.comments
  for each row execute function public.on_comment_insert();

create function public.delete_comment(p_comment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_c   record;
begin
  select id, author_id, template_id, deleted_at into v_c from public.comments where id = p_comment;
  if v_c.id is null or v_c.deleted_at is not null then
    raise exception 'Comment not found' using errcode = 'P0002';
  end if;
  if v_c.author_id is distinct from v_uid and not public.is_moderator() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.comments set deleted_at = now(), body = '[deleted]' where id = p_comment;
  update public.template_stats set comment_count = greatest(comment_count - 1, 0) where template_id = v_c.template_id;
  if v_c.author_id is distinct from v_uid then
    insert into public.moderation_log (actor_id, action, target_type, target_id)
    values (v_uid, 'delete_comment', 'comment', p_comment);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════ reports
create function public.limit_reports() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.reports
       where reporter_id = new.reporter_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Report limit reached for today' using errcode = '54000';
  end if;
  new.status := 'open';
  new.resolved_by := null;
  new.resolved_at := null;
  new.resolution_note := null;
  return new;
end $$;
create trigger reports_limit before insert on public.reports
  for each row execute function public.limit_reports();

-- ═══════════════════════════════════════════════════════════════ template lifecycle RPCs
create function public.slugify(p_text text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(trim(both '-' from left(
    regexp_replace(lower(p_text), '[^a-z0-9]+', '-', 'g'), 70)), ''), 'template');
$$;

create function public.create_template(p_title text, p_category_id smallint)
returns table (template_id uuid, slug text, version_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_verified_user();
  v_slug text := public.slugify(p_title);
  v_tpl  uuid;
  v_ver  uuid;
begin
  if (select count(*) from public.templates t
       where t.owner_id = v_uid and t.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You can start up to 10 templates a day' using errcode = '54000';
  end if;
  if exists (select 1 from public.templates t where t.slug = v_slug::extensions.citext) then
    v_slug := left(v_slug, 83) || '-' || substr(md5(random()::text), 1, 6);
  end if;

  insert into public.templates (owner_id, slug, title, category_id)
  values (v_uid, v_slug, btrim(p_title), p_category_id)
  returning id into v_tpl;

  insert into public.template_versions (template_id, owner_id, version)
  values (v_tpl, v_uid, '1.0.0')
  returning id into v_ver;

  return query select v_tpl, v_slug, v_ver;
end $$;

create function public.semver_key(p_version text) returns int[]
language sql immutable set search_path = '' as $$
  select array[split_part(p_version, '.', 1)::int, split_part(p_version, '.', 2)::int, split_part(p_version, '.', 3)::int];
$$;

create function public.create_version(p_template uuid, p_version text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := public.require_verified_user();
  v_tpl     record;
  v_latest  text;
  v_ver     uuid;
begin
  select id, owner_id, status into v_tpl from public.templates where id = p_template;
  if v_tpl.id is null or v_tpl.owner_id <> v_uid then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if v_tpl.status = 'removed' then
    raise exception 'This template was removed by a moderator' using errcode = '42501';
  end if;
  if exists (select 1 from public.template_versions where template_id = p_template and status = 'draft') then
    raise exception 'Finish or delete the current draft version first' using errcode = '23505';
  end if;
  select version into v_latest from public.template_versions
   where template_id = p_template and status <> 'draft'
   order by public.semver_key(version) desc limit 1;
  if v_latest is not null and public.semver_key(p_version) <= public.semver_key(v_latest) then
    raise exception 'New version must be greater than %', v_latest using errcode = '23514';
  end if;

  insert into public.template_versions (template_id, owner_id, version, license_code)
  values (p_template, v_uid, p_version,
          (select license_code from public.template_versions
            where template_id = p_template and status <> 'draft'
            order by public.semver_key(version) desc limit 1))
  returning id into v_ver;
  return v_ver;
end $$;

create function public.ext_to_tool(p_ext text) returns public.source_tool
language sql immutable set search_path = '' as $$
  select case p_ext
    when 'zip' then 'code' when 'fig' then 'figma' when 'psd' then 'psd'
    when 'ai' then 'ai' when 'sketch' then 'sketch' when 'xd' then 'xd'
    when 'penpot' then 'penpot' when 'pdf' then 'pdf'
  end::public.source_tool;
$$;

-- Called after the browser finished uploading to quarantine/{uid}/{template}/{version}/{uuid}.{ext}.
-- Size is read from Storage, never from the client.
create function public.register_file(p_version uuid, p_path text, p_original_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_verified_user();
  v_ver   record;
  v_parts text[] := string_to_array(p_path, '/');
  v_ext   text := lower(substring(p_path from '\.([A-Za-z0-9]+)$'));
  v_size  bigint;
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

  select (o.metadata ->> 'size')::bigint into v_size
    from storage.objects o where o.bucket_id = 'quarantine' and o.name = p_path;
  if v_size is null then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.template_files where version_id = p_version) >= 5 then
    raise exception 'A version can have at most 5 files' using errcode = '54000';
  end if;
  if coalesce((select sum(size_bytes) from public.template_files
                where owner_id = v_uid and scan_status not in ('infected', 'rejected')), 0) + v_size > 1073741824 then
    raise exception 'Storage quota (1 GB) exceeded' using errcode = '54000';
  end if;

  insert into public.template_files
    (version_id, template_id, owner_id, bucket, storage_path, original_name, ext, size_bytes, source_tool)
  values
    (p_version, v_ver.template_id, v_uid, 'quarantine', p_path,
     left(regexp_replace(coalesce(p_original_name, 'file.' || v_ext), '[\\/\x00-\x1f]', '_', 'g'), 200),
     v_ext, v_size, public.ext_to_tool(v_ext))
  returning id into v_id;
  return v_id;
end $$;

create function public.register_media(
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
  if p_path !~ ('^' || v_uid::text || '/' || p_template::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|avif|gif)$') then
    raise exception 'Invalid media path' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'media' and o.name = p_path) then
    raise exception 'Upload not found' using errcode = 'P0002';
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

create function public.set_template_tags(p_template uuid, p_tag_ids int[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user();
begin
  if not exists (select 1 from public.templates where id = p_template and owner_id = v_uid and status <> 'removed') then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if cardinality(p_tag_ids) > 10 then
    raise exception 'A template can have at most 10 tags' using errcode = '23514';
  end if;
  delete from public.template_tags where template_id = p_template;
  insert into public.template_tags (template_id, tag_id, owner_id)
  select p_template, t.id, v_uid from public.tags t where t.id = any (p_tag_ids);
end $$;

-- The publish gate. Everything that must be true before strangers can download.
create function public.publish_version(p_version uuid, p_attest boolean)
returns public.template_status
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := public.require_verified_user();
  v_ver     record;
  v_tpl     record;
  v_trust   smallint;
  v_status  public.template_status;
begin
  select * into v_ver from public.template_versions where id = p_version for update;
  if v_ver.id is null or v_ver.owner_id <> v_uid then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if v_ver.status <> 'draft' then
    raise exception 'This version is already published' using errcode = '42501';
  end if;
  select * into v_tpl from public.templates where id = v_ver.template_id for update;
  if v_tpl.status = 'removed' then
    raise exception 'This template was removed by a moderator' using errcode = '42501';
  end if;
  if not coalesce(p_attest, false) then
    raise exception 'Confirm that you own the rights to this work' using errcode = '23514';
  end if;
  if v_tpl.category_id is null then
    raise exception 'Choose a category' using errcode = '23514';
  end if;
  if v_ver.license_code is null then
    raise exception 'Choose a license' using errcode = '23514';
  end if;
  if not exists (select 1 from public.template_media where template_id = v_tpl.id and kind = 'cover') then
    raise exception 'Add a cover image' using errcode = '23514';
  end if;
  if exists (select 1 from public.template_files where version_id = p_version and scan_status <> 'clean') then
    raise exception 'Every file must pass the malware scan. Remove rejected files and wait for scans to finish.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.template_files where version_id = p_version)
     and not exists (select 1 from public.template_links where template_id = v_tpl.id)
     and v_tpl.demo_url is null then
    raise exception 'Add at least one file, source link or demo URL' using errcode = '23514';
  end if;

  update public.template_versions
     set status = 'published', published_at = now(), rights_attested_at = now()
   where id = p_version;

  select trust_level into v_trust from public.profiles where id = v_uid;
  v_status := v_tpl.status;
  if v_tpl.status = 'draft' then
    v_status := case when v_trust >= 1 then 'published' else 'pending_review' end;
  end if;

  update public.templates
     set current_version_id = p_version,
         status = v_status,
         status_reason = null,
         published_at = case when v_status = 'published' then coalesce(published_at, now()) else published_at end
   where id = v_tpl.id;
  return v_status;
end $$;

create function public.set_template_unlisted(p_template uuid, p_unlisted boolean)
returns public.template_status
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_tpl record;
  v_new public.template_status;
begin
  select id, owner_id, status into v_tpl from public.templates where id = p_template for update;
  if v_tpl.id is null or v_tpl.owner_id <> v_uid then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if p_unlisted and v_tpl.status = 'published' then v_new := 'unlisted';
  elsif not p_unlisted and v_tpl.status = 'unlisted' then v_new := 'published';
  else raise exception 'Only published templates can be unlisted or relisted' using errcode = '42501';
  end if;
  update public.templates set status = v_new where id = p_template;
  return v_new;
end $$;

create function public.yank_version(p_version uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  v_ver  record;
  v_next uuid;
begin
  select * into v_ver from public.template_versions where id = p_version for update;
  if v_ver.id is null or v_ver.owner_id <> v_uid then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if v_ver.status <> 'published' then
    raise exception 'Only published versions can be yanked' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a short reason' using errcode = '23514';
  end if;
  select id into v_next from public.template_versions
   where template_id = v_ver.template_id and status = 'published' and id <> p_version
   order by public.semver_key(version) desc limit 1;
  if v_next is null then
    raise exception 'Publish a replacement version before yanking the only one' using errcode = '23514';
  end if;
  update public.template_versions set status = 'yanked', yank_reason = btrim(p_reason) where id = p_version;
  update public.templates set current_version_id = v_next
   where id = v_ver.template_id and current_version_id = p_version;
end $$;

-- ═══════════════════════════════════════════════════════════════ moderation
create function public.moderate_template(p_template uuid, p_action text, p_reason text)
returns public.template_status
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_tpl record;
  v_new public.template_status;
begin
  if not public.is_moderator() then
    raise exception 'Moderators only' using errcode = '42501';
  end if;
  select id, owner_id, status into v_tpl from public.templates where id = p_template for update;
  if v_tpl.id is null then
    raise exception 'Template not found' using errcode = 'P0002';
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
      -- Reopen the rejected version as a new draft is the creator's call; the published row stays as history.
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

  insert into public.moderation_log (actor_id, action, target_type, target_id, reason, data)
  values (v_uid, p_action || '_template', 'template', p_template, nullif(btrim(coalesce(p_reason, '')), ''),
          jsonb_build_object('from', v_tpl.status, 'to', v_new));
  return v_new;
end $$;

create function public.resolve_report(p_report uuid, p_status public.report_status, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_moderator() then
    raise exception 'Moderators only' using errcode = '42501';
  end if;
  if p_status = 'open' then
    raise exception 'Choose resolved or dismissed' using errcode = '22023';
  end if;
  update public.reports
     set status = p_status, resolved_by = v_uid, resolved_at = now(), resolution_note = p_note
   where id = p_report and status = 'open';
  if not found then
    raise exception 'Open report not found' using errcode = 'P0002';
  end if;
  insert into public.moderation_log (actor_id, action, target_type, target_id, reason)
  values (v_uid, 'resolve_report', 'report', p_report, p_note);
end $$;

-- ═══════════════════════════════════════════════════════════════ downloads
-- Authorises a download and records it. The app then signs a 60 s URL for the
-- returned path with the service key; the key never decides who may download.
create function public.begin_download(p_file uuid, p_accept_license boolean default false)
returns table (bucket text, storage_path text, filename text, license_code text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  v_f    record;
begin
  select f.id, f.bucket, f.storage_path, f.ext, f.scan_status, f.version_id,
         v.status as version_status, v.version, v.license_code as lic,
         t.id as template_id, t.slug, t.status as template_status
    into v_f
    from public.template_files f
    join public.template_versions v on v.id = f.version_id
    join public.templates t on t.id = f.template_id
   where f.id = p_file;

  if v_f.id is null or v_f.template_status not in ('published', 'unlisted') then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  if v_f.version_status = 'yanked' then
    raise exception 'This version was pulled by the creator' using errcode = '42501';
  end if;
  if v_f.version_status <> 'published' or v_f.scan_status <> 'clean' or v_f.bucket <> 'template-files' then
    raise exception 'This file is not available yet' using errcode = '42501';
  end if;
  if (select count(*) from public.downloads d
       where d.user_id = v_uid and d.created_at > now() - interval '1 day') >= 200 then
    raise exception 'Daily download limit reached' using errcode = '54000';
  end if;
  if not exists (select 1 from public.license_acceptances a where a.user_id = v_uid and a.license_code = v_f.lic) then
    if not coalesce(p_accept_license, false) then
      raise exception 'LICENSE_NOT_ACCEPTED' using errcode = '23514';
    end if;
    insert into public.license_acceptances (user_id, license_code) values (v_uid, v_f.lic)
    on conflict do nothing;
  end if;

  -- Count once per user and version per 24 h so re-downloads do not inflate stats.
  if not exists (select 1 from public.downloads d
                  where d.user_id = v_uid and d.version_id = v_f.version_id
                    and d.created_at > now() - interval '1 day') then
    update public.template_stats set download_count = download_count + 1 where template_id = v_f.template_id;
  end if;
  insert into public.downloads (user_id, template_id, version_id, file_id, license_code)
  values (v_uid, v_f.template_id, v_f.version_id, v_f.id, v_f.lic);

  return query select v_f.bucket, v_f.storage_path,
                      v_f.slug || '-v' || v_f.version || '.' || v_f.ext, v_f.lic;
end $$;

-- Outbound "Open in Figma/Canva" clicks. Returns the stored URL only, never a caller-supplied one.
create function public.resolve_link(p_template uuid, p_kind public.link_kind) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_url text;
  v_ver uuid;
  v_lic text;
begin
  select l.url, t.current_version_id into v_url, v_ver
    from public.template_links l join public.templates t on t.id = l.template_id
   where l.template_id = p_template and l.kind = p_kind and t.status in ('published', 'unlisted');
  if v_url is null then
    raise exception 'Link not found' using errcode = 'P0002';
  end if;
  if v_uid is not null then
    select license_code into v_lic from public.template_versions where id = v_ver;
    if not exists (select 1 from public.downloads d
                    where d.user_id = v_uid and d.template_id = p_template and d.link_kind = p_kind
                      and d.created_at > now() - interval '1 day') then
      update public.template_stats set download_count = download_count + 1 where template_id = p_template;
    end if;
    insert into public.downloads (user_id, template_id, version_id, link_kind, license_code)
    values (v_uid, p_template, v_ver, p_kind, v_lic);
  end if;
  return v_url;
end $$;

-- ═══════════════════════════════════════════════════════════════ scan pipeline (service role only)
-- The file row itself is the queue: FOR UPDATE SKIP LOCKED lets several workers
-- share it, and a scan stuck for 15 minutes is retried up to 3 times.
create function public.claim_scan_jobs(p_limit int default 1)
returns table (id uuid, storage_path text, ext text, original_name text, size_bytes bigint)
language plpgsql security definer set search_path = '' as $$
begin
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

create function public.complete_scan(
  p_file uuid, p_status public.scan_status, p_new_path text, p_sha256 text,
  p_manifest jsonb, p_report jsonb, p_reject_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_f record;
begin
  if p_status not in ('clean', 'infected', 'rejected') then
    raise exception 'Invalid final scan status' using errcode = '22023';
  end if;
  select id, owner_id, template_id, original_name into v_f
    from public.template_files where id = p_file and scan_status = 'scanning' for update;
  if v_f.id is null then
    raise exception 'File is not being scanned' using errcode = 'P0002';
  end if;
  update public.template_files set
    scan_status   = p_status,
    scanned_at    = now(),
    bucket        = case when p_status = 'clean' then 'template-files' else bucket end,
    storage_path  = case when p_status = 'clean' then p_new_path else storage_path end,
    sha256        = p_sha256,
    manifest      = case when p_status = 'clean' then p_manifest else null end,
    scan_report   = p_report,
    reject_reason = case when p_status = 'clean' then null else p_reject_reason end
  where id = p_file;
  if p_status <> 'clean' then
    perform public.notify(v_f.owner_id, 'scan_failed', null, v_f.template_id, null,
                          jsonb_build_object('file', v_f.original_name, 'reason', p_reject_reason));
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════ notifications, views, ranking
create function public.mark_notifications_read(p_ids bigint[] default null) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
   where user_id = (select auth.uid()) and read_at is null
     and (p_ids is null or id = any (p_ids));
$$;

-- Batched view counts flushed from Redis. Service role only.
create function public.record_views(p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(template_id uuid, day date, views int) loop
    if r.views is null or r.views <= 0 then continue; end if;
    insert into public.template_view_daily (template_id, day, views)
    values (r.template_id, r.day, r.views)
    on conflict (template_id, day) do update set views = public.template_view_daily.views + excluded.views;
    update public.template_stats set view_count = view_count + r.views where template_id = r.template_id;
  end loop;
end $$;

-- Trending score. Only templates published in the last 30 days are recomputed;
-- older ones decay to ~0 and are zeroed once, so the job stays cheap at any size.
create function public.refresh_hot_scores() returns void
language plpgsql security definer set search_path = '' as $$
begin
  with recent as (
    select t.id,
           extract(epoch from (now() - t.published_at)) / 3600.0 as age_h,
           coalesce((select count(*) from public.downloads d
                      where d.template_id = t.id and d.created_at > now() - interval '7 days'), 0) as dl7,
           coalesce((select sum(v.views) from public.template_view_daily v
                      where v.template_id = t.id and v.day > current_date - 7), 0) as views7
      from public.templates t
     where t.status = 'published' and t.published_at > now() - interval '30 days'
  )
  update public.template_stats s
     set hot_score = (s.like_count + 2 * s.vote_count + 3 * r.dl7 + r.views7 / 20.0)
                     / power(r.age_h + 2, 1.5)
    from recent r where s.template_id = r.id;

  update public.template_stats s set hot_score = 0
    from public.templates t
   where t.id = s.template_id and s.hot_score <> 0
     and (t.status <> 'published' or t.published_at <= now() - interval '30 days');
end $$;

-- ═══════════════════════════════════════════════════════════════ account deletion
-- Soft delete now; a scheduled job purges auth.users after 30 days.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  update public.profiles
     set deleted_at = now(), bio = null, website = null, github = null, x_handle = null,
         location = null, skills = '{}', available_for_hire = false, avatar_path = null, banner_path = null
   where id = v_uid;
  update public.templates set status = 'unlisted'
   where owner_id = v_uid and status = 'published';
  delete from public.follows where follower_id = v_uid or followee_id = v_uid;
  insert into public.moderation_log (actor_id, action, target_type, target_id)
  values (v_uid, 'delete_account', 'profile', v_uid);
end $$;

-- ═══════════════════════════════════════════════════════════════ execute grants
-- Start from nothing, then grant each callable function explicitly.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.has_role(public.app_role), public.is_moderator(), public.is_admin(),
  public.auth_email_verified(), public.vote_eligibility(uuid), public.slugify(text),
  public.semver_key(text), public.ext_to_tool(text), public.template_has_code(uuid)
to anon, authenticated;

grant execute on function
  public.create_template(text, smallint), public.create_version(uuid, text),
  public.register_file(uuid, text, text),
  public.register_media(uuid, text, public.media_kind, public.device_kind, text, int, int),
  public.set_template_tags(uuid, int[]), public.publish_version(uuid, boolean),
  public.set_template_unlisted(uuid, boolean), public.yank_version(uuid, text),
  public.delete_comment(uuid), public.moderate_template(uuid, text, text),
  public.resolve_report(uuid, public.report_status, text),
  public.begin_download(uuid, boolean), public.mark_notifications_read(bigint[]),
  public.delete_my_account()
to authenticated;

grant execute on function public.resolve_link(uuid, public.link_kind) to anon, authenticated;

grant execute on function
  public.claim_scan_jobs(int),
  public.complete_scan(uuid, public.scan_status, text, text, jsonb, jsonb, text),
  public.record_views(jsonb), public.refresh_hot_scores()
to service_role;
