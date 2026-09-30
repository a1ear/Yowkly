-- Friends, activity status, and the admin toolset.
--
-- Friends = mutual follows (you follow them and they follow you back).
--   * A profile's friends list is private unless its owner makes it public.
--   * Sub-admins can only be picked from the admin's friends.
--
-- Activity status (like Discord): online, idle or offline.
--   * People choose Online, Idle or Appear offline. On top of that, nobody is
--     shown online unless the site heard from them in the last 3 minutes, and
--     an open-but-untouched tab turns idle after 10 minutes.
--   * Status is only ever shown to friends (and yourself). Raw timestamps are
--     never exposed: presence lives in its own private table, because every
--     column of `profiles` is public.
--
-- Admin tools: overview numbers, a user directory with emails (admins only),
-- moderator and trust changes, and account suspension. A suspended account
-- can read but can't do anything: every RPC starts with require_user(), and a
-- restrictive policy blocks direct writes too. Everything is logged.

-- ═══════════════════════════════════════════════════════════════ friends
create function public.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and exists (select 1 from public.follows where follower_id = p_a and followee_id = p_b)
     and exists (select 1 from public.follows where follower_id = p_b and followee_id = p_a);
$$;

alter table public.profiles add column friends_public boolean not null default false;
grant update (friends_public) on public.profiles to authenticated;

create function public.can_see_friends(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) = p_user
      or coalesce((select friends_public from public.profiles where id = p_user and deleted_at is null), false);
$$;

-- A creator's friends, if the list is public or it's your own.
create function public.friends_of(p_user uuid)
returns table (id uuid, username text, display_name text, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username::text, p.display_name, p.avatar_path
    from public.follows a
    join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id
    join public.profiles p on p.id = a.followee_id and p.deleted_at is null
   where a.follower_id = p_user and public.can_see_friends(p_user)
   order by lower(p.display_name)
   limit 500;
$$;

-- ═══════════════════════════════════════════════════════════════ presence
create table public.user_presence (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  status_mode    text not null default 'online' check (status_mode in ('online', 'idle', 'invisible')),
  last_seen_at   timestamptz,
  last_active_at timestamptz
);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;
grant select on public.user_presence to authenticated;
create policy "presence: read own" on public.user_presence for select to authenticated
  using (user_id = (select auth.uid()));

-- Internal: what everyone else should see. Not granted to clients.
create function public.presence_status(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when pr.status_mode = 'invisible' or pr.last_seen_at is null or pr.last_seen_at < now() - interval '3 minutes' then 'offline'
      when pr.status_mode = 'idle' or pr.last_active_at is null or pr.last_active_at < now() - interval '10 minutes' then 'idle'
      else 'online'
    end
    from public.user_presence pr where pr.user_id = p_user
  ), 'offline');
$$;

-- The browser calls this about once a minute while the site is open.
create function public.touch_presence(p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  insert into public.user_presence (user_id, last_seen_at, last_active_at)
  values (v_uid, now(), case when p_active then now() end)
  on conflict (user_id) do update
    set last_seen_at = now(),
        last_active_at = case when p_active then now() else public.user_presence.last_active_at end;
end $$;

create function public.set_my_status(p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if p_mode not in ('online', 'idle', 'invisible') then
    raise exception 'Choose Online, Idle or Appear offline' using errcode = '22023';
  end if;
  insert into public.user_presence (user_id, status_mode, last_seen_at, last_active_at)
  values (v_uid, p_mode, now(), now())
  on conflict (user_id) do update set status_mode = p_mode, last_seen_at = now(), last_active_at = now();
end $$;

-- Your own chosen mode and how others currently see you.
create function public.my_presence() returns table (status_mode text, status text)
language sql stable security definer set search_path = '' as $$
  select coalesce((select pr.status_mode from public.user_presence pr where pr.user_id = (select auth.uid())), 'online'),
         public.presence_status((select auth.uid()))
   where (select auth.uid()) is not null;
$$;

-- Your friends with their status: online first, then idle, then offline.
create function public.my_friends()
returns table (id uuid, username text, display_name text, avatar_path text, status text)
language sql stable security definer set search_path = '' as $$
  select f.id, f.username, f.display_name, f.avatar_path, public.presence_status(f.id) as status
    from public.friends_of((select auth.uid())) f
   where (select auth.uid()) is not null
   order by case public.presence_status(f.id) when 'online' then 0 when 'idle' then 1 else 2 end, lower(f.display_name);
$$;

-- One person's status, only if you are friends (or it's you). Otherwise null.
create function public.user_status(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when (select auth.uid()) = p_user or public.are_friends((select auth.uid()), p_user)
              then public.presence_status(p_user) end;
$$;

-- ═══════════════════════════════════════════════════════════════ sub-admins are friends
create or replace function public.set_sub_admin(p_user uuid, p_on boolean)
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
    if not public.are_friends(v_uid, p_user) then
      raise exception 'Only friends can be made sub-admins: they follow you and you follow them back' using errcode = '42501';
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

drop function public.sub_admin_candidates();
create function public.sub_admin_candidates()
returns table (id uuid, username text, display_name text, avatar_path text, is_sub_admin boolean, is_friend boolean,
               follows_you boolean, you_follow boolean)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid)
  select p.id, p.username::text, p.display_name, p.avatar_path,
         exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'reviewer'),
         public.are_friends(me.uid, p.id),
         exists (select 1 from public.follows f where f.follower_id = p.id and f.followee_id = me.uid),
         exists (select 1 from public.follows f where f.follower_id = me.uid and f.followee_id = p.id)
    from public.profiles p, me
   where public.is_admin() and p.deleted_at is null and p.id <> me.uid
     and (exists (select 1 from public.follows f where f.follower_id = p.id and f.followee_id = me.uid)
          or exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'reviewer'))
   order by 5 desc, 6 desc, lower(p.display_name)
   limit 500;
$$;

-- ═══════════════════════════════════════════════════════════════ suspensions
create table public.user_suspensions (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  reason       text not null check (char_length(reason) between 3 and 500),
  suspended_by uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.user_suspensions enable row level security;
revoke all on public.user_suspensions from anon, authenticated;
grant select on public.user_suspensions to authenticated;
create policy "suspensions: own or staff" on public.user_suspensions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_moderator()));

create function public.is_suspended(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (select 1 from public.user_suspensions where user_id = p_user);
$$;

-- Every RPC starts here, so a suspension stops uploads, votes, posts, comments and downloads at once.
create or replace function public.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if public.is_suspended(v_uid) then
    raise exception 'Your account is suspended. Contact support if you think this is a mistake.' using errcode = '42501';
  end if;
  return v_uid;
end $$;

-- ...and direct table writes are blocked too (restrictive: ANDed with every other policy).
do $$
declare t text;
begin
  foreach t in array array['collection_items', 'comments', 'follows', 'likes', 'post_comment_likes', 'post_likes', 'reports', 'template_links'] loop
    execute format('create policy "suspended accounts can''t write" on public.%I as restrictive for insert to authenticated
                    with check (not public.is_suspended((select auth.uid())))', t);
  end loop;
  foreach t in array array['templates', 'template_versions', 'template_media', 'profiles', 'template_links'] loop
    execute format('create policy "suspended accounts can''t edit" on public.%I as restrictive for update to authenticated
                    using (not public.is_suspended((select auth.uid())))', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════ admin tools
create function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_moderator() then
    raise exception 'Moderators only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users',            (select count(*) from public.profiles where deleted_at is null),
    'users_7d',         (select count(*) from public.profiles where deleted_at is null and created_at > now() - interval '7 days'),
    'online_now',       (select count(*) from public.user_presence where last_seen_at > now() - interval '3 minutes' and status_mode <> 'invisible'),
    'suspended',        (select count(*) from public.user_suspensions),
    'published',        (select count(*) from public.templates where status = 'published'),
    'pending',          (select count(*) from public.templates where status = 'pending_review'),
    'drafts',           (select count(*) from public.templates where status = 'draft'),
    'removed',          (select count(*) from public.templates where status = 'removed'),
    'open_reports',     (select count(*) from public.reports where status = 'open'),
    'scan_queue',       (select count(*) from public.template_files where scan_status in ('pending', 'scanning')),
    'scan_rejected_7d', (select count(*) from public.template_files where scan_status in ('infected', 'rejected') and created_at > now() - interval '7 days'),
    'downloads_7d',     (select count(*) from public.downloads where created_at > now() - interval '7 days'),
    'votes_7d',         (select count(*) from public.votes where created_at > now() - interval '7 days'),
    'posts_7d',         (select count(*) from public.posts where created_at > now() - interval '7 days' and status = 'published')
  );
end $$;

-- The user directory (emails included), admins only.
create function public.admin_users(p_q text default null, p_limit int default 50)
returns table (id uuid, username text, display_name text, email text, avatar_path text, created_at timestamptz,
               last_seen_at timestamptz, roles text[], trust_level smallint, template_count int,
               suspended boolean, suspended_reason text)
language sql stable security definer set search_path = '' as $$
  with q as (select replace(replace(replace(btrim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') as pat)
  select p.id, p.username::text, p.display_name, u.email::text, p.avatar_path, p.created_at,
         pr.last_seen_at,
         coalesce((select array_agg(r.role::text order by r.role) from public.user_roles r where r.user_id = p.id), '{}'),
         p.trust_level,
         (select count(*)::int from public.templates t where t.owner_id = p.id and t.status = 'published'),
         s.user_id is not null, s.reason
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.user_presence pr on pr.user_id = p.id
    left join public.user_suspensions s on s.user_id = p.id
    cross join q
   where public.is_admin() and p.deleted_at is null
     and (q.pat = '' or p.username::text ilike '%' || q.pat || '%' or p.display_name ilike '%' || q.pat || '%' or u.email ilike '%' || q.pat || '%')
   order by p.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

create function public.admin_set_moderator(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_user = v_uid then raise exception 'You can''t change your own role' using errcode = '22023'; end if;
  if p_on then
    insert into public.user_roles (user_id, role, granted_by) values (p_user, 'moderator', v_uid) on conflict do nothing;
  else
    delete from public.user_roles where user_id = p_user and role = 'moderator';
  end if;
  insert into public.moderation_log (actor_id, action, target_type, target_id)
  values (v_uid, case when p_on then 'grant_moderator' else 'revoke_moderator' end, 'profile', p_user);
end $$;

-- Trusted creators publish without review (the same level two approvals earn).
create function public.admin_set_trust(p_user uuid, p_trusted boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.profiles set trust_level = case when p_trusted then greatest(trust_level, 1) else 0 end where id = p_user;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  insert into public.moderation_log (actor_id, action, target_type, target_id)
  values (v_uid, case when p_trusted then 'trust_creator' else 'untrust_creator' end, 'profile', p_user);
end $$;

create function public.admin_suspend(p_user uuid, p_on boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_user = v_uid then raise exception 'You can''t suspend yourself' using errcode = '22023'; end if;
  if p_on then
    if exists (select 1 from public.user_roles where user_id = p_user and role = 'admin') then
      raise exception 'Admins can''t be suspended' using errcode = '42501';
    end if;
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then
      raise exception 'A reason is required' using errcode = '23514';
    end if;
    insert into public.user_suspensions (user_id, reason, suspended_by) values (p_user, btrim(p_reason), v_uid)
    on conflict (user_id) do update set reason = excluded.reason, suspended_by = excluded.suspended_by, created_at = now();
    -- Staff roles don't survive a suspension.
    delete from public.user_roles where user_id = p_user and role in ('reviewer', 'moderator');
  else
    delete from public.user_suspensions where user_id = p_user;
  end if;
  insert into public.moderation_log (actor_id, action, target_type, target_id, reason)
  values (v_uid, case when p_on then 'suspend_user' else 'unsuspend_user' end, 'profile', p_user, nullif(btrim(coalesce(p_reason, '')), ''));
end $$;

-- ═══════════════════════════════════════════════════════════════ access
revoke execute on function public.presence_status(uuid), public.is_suspended(uuid), public.are_friends(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.touch_presence(boolean), public.set_my_status(text), public.my_presence(), public.my_friends(),
  public.admin_overview(), public.admin_users(text, int), public.admin_set_moderator(uuid, boolean),
  public.admin_set_trust(uuid, boolean), public.admin_suspend(uuid, boolean, text), public.sub_admin_candidates()
  from public, anon;
grant execute on function public.touch_presence(boolean), public.set_my_status(text), public.my_presence(), public.my_friends(),
  public.admin_overview(), public.admin_users(text, int), public.admin_set_moderator(uuid, boolean),
  public.admin_set_trust(uuid, boolean), public.admin_suspend(uuid, boolean, text), public.sub_admin_candidates()
  to authenticated;
grant execute on function public.friends_of(uuid), public.can_see_friends(uuid), public.user_status(uuid) to anon, authenticated;
-- RLS policies call is_suspended as the signed-in user.
grant execute on function public.is_suspended(uuid) to authenticated;
