-- Channels: topic communities inside Community (like subreddits / Discord servers).
--
--   * Any verified user can create a channel (up to 5 they own, 3 a day) and
--     becomes its owner.
--   * Anyone can read a channel; joining lets you post and comment in it.
--   * The owner makes members moderators (and back). Owner and moderators can
--     remove posts, kick members and ban people with a reason; moderators can't
--     act on the owner or on other moderators. Every action is logged per channel.
--   * Site moderators keep their powers everywhere.
--   * Posts can belong to a channel; they still show in the main feed, labelled.

create table public.channels (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,30}$'),
  name         text not null check (char_length(btrim(name)) between 3 and 40),
  description  text check (char_length(description) <= 300),
  rules        text check (char_length(rules) <= 2000),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  member_count integer not null default 0 check (member_count >= 0),
  post_count   integer not null default 0 check (post_count >= 0),
  created_at   timestamptz not null default now()
);
create index channels_members_idx on public.channels (member_count desc);
create index channels_name_trgm_idx on public.channels using gin (name extensions.gin_trgm_ops);

create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'mod', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index channel_members_user_idx on public.channel_members (user_id, joined_at desc);

create table public.channel_bans (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reason     text not null check (char_length(reason) between 3 and 500),
  banned_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

-- What channel staff did, readable by that channel's staff.
create table public.channel_mod_log (
  id         bigint generated always as identity primary key,
  channel_id uuid not null references public.channels (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  target_id  uuid,
  reason     text,
  created_at timestamptz not null default now()
);

alter table public.posts add column channel_id uuid references public.channels (id) on delete set null;
create index posts_channel_idx on public.posts (channel_id, created_at desc) where status = 'published';

-- Member and post counters on the channel.
create function public.bump_channel_members() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.channels set member_count = member_count + 1 where id = new.channel_id;
  else update public.channels set member_count = greatest(member_count - 1, 0) where id = old.channel_id; end if;
  return null;
end $$;
create trigger channel_members_count after insert or delete on public.channel_members
  for each row execute function public.bump_channel_members();

create function public.bump_channel_posts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.channel_id is not null and new.status = 'published' then
    update public.channels set post_count = post_count + 1 where id = new.channel_id;
  elsif tg_op = 'UPDATE' and new.channel_id is not null and old.status = 'published' and new.status = 'removed' then
    update public.channels set post_count = greatest(post_count - 1, 0) where id = new.channel_id;
  end if;
  return null;
end $$;
create trigger posts_channel_count after insert or update of status on public.posts
  for each row execute function public.bump_channel_posts();

-- ═══════════════════════════════════════════════════════════════ helpers
create function public.channel_role(p_channel uuid, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.channel_members where channel_id = p_channel and user_id = p_user;
$$;

create function public.is_channel_staff(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.channel_role(p_channel, (select auth.uid())) in ('owner', 'mod') or public.is_moderator();
$$;

create function public.is_channel_banned(p_channel uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.channel_bans where channel_id = p_channel and user_id = p_user);
$$;

-- ═══════════════════════════════════════════════════════════════ access
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.channel_bans enable row level security;
alter table public.channel_mod_log enable row level security;
revoke all on public.channels, public.channel_members, public.channel_bans, public.channel_mod_log from anon, authenticated;
grant select on public.channels, public.channel_members to anon, authenticated;
create policy "channels: public" on public.channels for select using (true);
create policy "channel members: public" on public.channel_members for select using (true);
grant select on public.channel_bans, public.channel_mod_log to authenticated;
create policy "channel bans: staff, or the banned person" on public.channel_bans for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_channel_staff(channel_id)));
create policy "channel log: staff" on public.channel_mod_log for select to authenticated
  using ((select public.is_channel_staff(channel_id)));

-- ═══════════════════════════════════════════════════════════════ reads
create view public.channel_cards with (security_invoker = true) as
select c.id, c.slug, c.name, c.description, c.rules, c.member_count, c.post_count, c.created_at, c.owner_id,
       p.username::text as owner_username, p.display_name as owner_display_name
  from public.channels c join public.profiles p on p.id = c.owner_id;
grant select on public.channel_cards to anon, authenticated;

-- Channels you're in, with your role.
create function public.my_channels() returns table (id uuid, slug text, name text, member_count int, role text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.slug, c.name, c.member_count, m.role
    from public.channel_members m join public.channels c on c.id = m.channel_id
   where m.user_id = (select auth.uid())
   order by (m.role = 'owner') desc, (m.role = 'mod') desc, lower(c.name)
   limit 100;
$$;

-- Same view as before, with the channel appended (create or replace can only add columns at the end).
create or replace view public.post_cards with (security_invoker = true) as
select po.id, po.body, po.tags, po.like_count, po.created_at, po.author_id,
       p.username::text as author_username, p.display_name as author_display_name, p.avatar_path as author_avatar_path,
       po.comment_count, po.dislike_count, po.edited_at,
       coalesce((select jsonb_agg(jsonb_build_object('path', i.path, 'alt', i.alt_text, 'width', i.width, 'height', i.height) order by i.sort)
                   from public.post_images i where i.post_id = po.id), '[]') as images,
       po.channel_id, ch.slug as channel_slug, ch.name as channel_name
  from public.posts po
  join public.profiles p on p.id = po.author_id
  left join public.channels ch on ch.id = po.channel_id
 where po.status = 'published';

-- ═══════════════════════════════════════════════════════════════ writes
create function public.create_channel(p_name text, p_slug text, p_description text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_verified_user();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_id   uuid;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 3 and 40 then
    raise exception 'Channel names are 3 to 40 characters.' using errcode = '23514';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{2,30}$' then
    raise exception 'The channel address is 3 to 31 lowercase letters, numbers or dashes.' using errcode = '23514';
  end if;
  if char_length(coalesce(p_description, '')) > 300 then
    raise exception 'Keep the description under 300 characters.' using errcode = '23514';
  end if;
  if (select count(*) from public.channels where owner_id = v_uid) >= 5 then
    raise exception 'You can own up to 5 channels.' using errcode = '54000';
  end if;
  if (select count(*) from public.channels where owner_id = v_uid and created_at > now() - interval '1 day') >= 3 then
    raise exception 'You can create up to 3 channels a day.' using errcode = '54000';
  end if;
  if exists (select 1 from public.channels where slug = v_slug) then
    raise exception 'That channel address is taken.' using errcode = '23505';
  end if;
  insert into public.channels (slug, name, description, owner_id)
  values (v_slug, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), v_uid) returning id into v_id;
  insert into public.channel_members (channel_id, user_id, role) values (v_id, v_uid, 'owner');
  return v_id;
end $$;

create function public.update_channel(p_channel uuid, p_name text, p_description text, p_rules text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if public.channel_role(p_channel, v_uid) is distinct from 'owner' and not public.is_moderator() then
    raise exception 'Only the owner can edit the channel.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 3 and 40 then
    raise exception 'Channel names are 3 to 40 characters.' using errcode = '23514';
  end if;
  update public.channels
     set name = btrim(p_name), description = nullif(left(btrim(coalesce(p_description, '')), 300), ''),
         rules = nullif(left(btrim(coalesce(p_rules, '')), 2000), '')
   where id = p_channel;
  insert into public.channel_mod_log (channel_id, actor_id, action) values (p_channel, v_uid, 'edit_channel');
end $$;

create function public.delete_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if public.channel_role(p_channel, v_uid) is distinct from 'owner' and not public.is_moderator() then
    raise exception 'Only the owner can delete the channel.' using errcode = '42501';
  end if;
  -- Its posts are hidden, not erased (reports about them can still be judged).
  update public.posts set status = 'removed', removed_by = v_uid, removed_at = now(), removed_reason = 'Channel deleted'
   where channel_id = p_channel and status = 'published';
  insert into public.moderation_log (actor_id, action, target_type, target_id) values (v_uid, 'delete_channel', 'channel', p_channel);
  delete from public.channels where id = p_channel;
end $$;

create function public.join_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user();
begin
  if not exists (select 1 from public.channels where id = p_channel) then
    raise exception 'Channel not found.' using errcode = 'P0002';
  end if;
  if public.is_channel_banned(p_channel, v_uid) then
    raise exception 'You are banned from this channel.' using errcode = '42501';
  end if;
  if (select count(*) from public.channel_members where user_id = v_uid) >= 200 then
    raise exception 'You can be in up to 200 channels.' using errcode = '54000';
  end if;
  insert into public.channel_members (channel_id, user_id) values (p_channel, v_uid) on conflict do nothing;
end $$;

create function public.leave_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if public.channel_role(p_channel, v_uid) = 'owner' then
    raise exception 'Owners can''t leave their own channel. Delete it instead.' using errcode = '42501';
  end if;
  delete from public.channel_members where channel_id = p_channel and user_id = v_uid;
end $$;

-- Owner only: make a member a moderator, or a moderator a member.
create function public.set_channel_role(p_channel uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if public.channel_role(p_channel, v_uid) is distinct from 'owner' then
    raise exception 'Only the owner can change roles.' using errcode = '42501';
  end if;
  if p_role not in ('mod', 'member') then
    raise exception 'Choose moderator or member.' using errcode = '22023';
  end if;
  if p_user = v_uid then raise exception 'You are the owner.' using errcode = '22023'; end if;
  update public.channel_members set role = p_role where channel_id = p_channel and user_id = p_user and role <> 'owner';
  if not found then raise exception 'That person isn''t a member.' using errcode = 'P0002'; end if;
  insert into public.channel_mod_log (channel_id, actor_id, action, target_id)
  values (p_channel, v_uid, case when p_role = 'mod' then 'make_mod' else 'remove_mod' end, p_user);
end $$;

-- Kick (remove) or ban a member. Moderators can only act on ordinary members.
create function public.moderate_channel_member(p_channel uuid, p_user uuid, p_action text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  v_mine   text := public.channel_role(p_channel, v_uid);
  v_theirs text := public.channel_role(p_channel, p_user);
begin
  if v_mine not in ('owner', 'mod') and not public.is_moderator() then
    raise exception 'Only channel moderators can do that.' using errcode = '42501';
  end if;
  if p_user = v_uid then raise exception 'You can''t do that to yourself.' using errcode = '22023'; end if;
  if v_theirs = 'owner' or (v_theirs = 'mod' and v_mine is distinct from 'owner' and not public.is_moderator()) then
    raise exception 'You can''t act on the owner or another moderator.' using errcode = '42501';
  end if;
  case p_action
    when 'kick' then
      delete from public.channel_members where channel_id = p_channel and user_id = p_user;
    when 'ban' then
      if char_length(btrim(coalesce(p_reason, ''))) < 3 then
        raise exception 'A reason is required.' using errcode = '23514';
      end if;
      delete from public.channel_members where channel_id = p_channel and user_id = p_user;
      insert into public.channel_bans (channel_id, user_id, reason, banned_by) values (p_channel, p_user, left(btrim(p_reason), 500), v_uid)
      on conflict (channel_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by, created_at = now();
    when 'unban' then
      delete from public.channel_bans where channel_id = p_channel and user_id = p_user;
    else
      raise exception 'Unknown action.' using errcode = '22023';
  end case;
  insert into public.channel_mod_log (channel_id, actor_id, action, target_id, reason)
  values (p_channel, v_uid, p_action, p_user, nullif(btrim(coalesce(p_reason, '')), ''));
end $$;

-- Posting into a channel: members only, never while banned. Wraps the existing create_post.
create function public.create_channel_post(p_channel uuid, p_body text, p_tags text[] default '{}', p_images jsonb default '[]') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user(); v_id uuid;
begin
  if public.is_channel_banned(p_channel, v_uid) then
    raise exception 'You are banned from this channel.' using errcode = '42501';
  end if;
  if public.channel_role(p_channel, v_uid) is null then
    raise exception 'Join the channel to post in it.' using errcode = '42501';
  end if;
  v_id := public.create_post(p_body, p_tags, p_images);
  update public.posts set channel_id = p_channel where id = v_id;
  update public.channels set post_count = post_count + 1 where id = p_channel;
  return v_id;
end $$;

-- Removing posts: the author, a site moderator, or (new) the staff of the post's channel.
create or replace function public.delete_post(p_post uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_p   record;
  v_channel_staff boolean;
begin
  select id, author_id, status, channel_id into v_p from public.posts where id = p_post for update;
  if v_p.id is null or v_p.status = 'removed' then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  v_channel_staff := v_p.channel_id is not null and public.channel_role(v_p.channel_id, v_uid) in ('owner', 'mod');
  if v_p.author_id is distinct from v_uid then
    if not public.is_moderator() and not v_channel_staff then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then
      raise exception 'A reason is required.' using errcode = '23514';
    end if;
  end if;

  update public.posts
     set status = 'removed', removed_by = v_uid, removed_at = now(),
         removed_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
   where id = p_post;

  if v_p.author_id is distinct from v_uid then
    if v_channel_staff and not public.is_moderator() then
      insert into public.channel_mod_log (channel_id, actor_id, action, target_id, reason)
      values (v_p.channel_id, v_uid, 'remove_post', p_post, btrim(p_reason));
    else
      insert into public.moderation_log (actor_id, action, target_type, target_id, reason)
      values (v_uid, 'remove_post', 'post', p_post, btrim(p_reason));
    end if;
  end if;
end $$;

-- Banned people can't comment on a channel's posts either.
create function public.guard_channel_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_channel uuid;
begin
  select channel_id into v_channel from public.posts where id = new.post_id;
  if v_channel is not null and public.is_channel_banned(v_channel, new.author_id) then
    raise exception 'You are banned from this channel.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger post_comments_channel_ban before insert on public.post_comments
  for each row execute function public.guard_channel_comment();

-- The counter trigger above would double-count posts created by create_channel_post
-- (the post is inserted first, then moved into the channel), so it only counts removals.
drop trigger posts_channel_count on public.posts;
create trigger posts_channel_count after update of status on public.posts
  for each row execute function public.bump_channel_posts();

revoke execute on function public.bump_channel_members(), public.bump_channel_posts(), public.guard_channel_comment(),
  public.channel_role(uuid, uuid), public.is_channel_banned(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.create_channel(text, text, text), public.update_channel(uuid, text, text, text),
  public.delete_channel(uuid), public.join_channel(uuid), public.leave_channel(uuid), public.set_channel_role(uuid, uuid, text),
  public.moderate_channel_member(uuid, uuid, text, text), public.create_channel_post(uuid, text, text[], jsonb), public.my_channels()
  from public, anon;
grant execute on function public.create_channel(text, text, text), public.update_channel(uuid, text, text, text),
  public.delete_channel(uuid), public.join_channel(uuid), public.leave_channel(uuid), public.set_channel_role(uuid, uuid, text),
  public.moderate_channel_member(uuid, uuid, text, text), public.create_channel_post(uuid, text, text[], jsonb), public.my_channels()
  to authenticated;
grant execute on function public.is_channel_staff(uuid) to anon, authenticated;
