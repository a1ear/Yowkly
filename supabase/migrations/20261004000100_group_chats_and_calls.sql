-- Group chats and group calls.
--
-- Group chats:
--   * Anyone can start a group with 2 to 9 of their friends (10 people at most,
--     including them). The creator is the first admin.
--   * Admins add people (only their own friends, never across a block), remove
--     people, rename the group and make other members admins. The creator can't
--     be removed or demoted by anyone else. A group always keeps an admin: when
--     the last one leaves, the longest-standing member takes over.
--   * Only current members can read the group (the same RLS check as 1-to-1
--     chats, extended to group membership), including over Realtime. Someone who
--     leaves or is removed loses access to the history.
--   * Joins, leaves, renames and admin changes are written into the chat as
--     small notices (kind = 'system'), so everyone sees what changed and by whom.
--
-- Group calls:
--   * Any member can start a voice or video call in their group; everyone else
--     in the group rings for 45 seconds. Members can also join a call that is
--     already going. Up to 6 people can be in a call at once.
--   * The audio and video go directly between the browsers (each pair of people
--     connects; no media server). The database tracks who is in the call; each
--     browser checks in every few seconds, and someone who stops checking in
--     (closed tab, lost connection) is taken out of the call. The call ends when
--     the last person leaves, and a summary is added to the chat.

-- ═══════════════════════════════════════════════════════════════ group chats
alter table public.conversations
  add column kind       text not null default 'direct' check (kind in ('direct', 'group')),
  add column title      text check (char_length(title) between 1 and 60),
  add column created_by uuid references public.profiles (id) on delete set null,
  add column last_kind  text check (last_kind in ('text', 'call', 'system')),
  alter column user_a drop not null,
  alter column user_b drop not null;
alter table public.conversations add constraint conversations_shape check (
  (kind = 'direct' and user_a is not null and user_b is not null and title is null)
  or (kind = 'group' and user_a is null and user_b is null and title is not null));
create index conversations_groups_by_creator_idx on public.conversations (created_by, created_at) where kind = 'group';

alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'call', 'system'));

create table public.group_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            text not null default 'member' check (role in ('admin', 'member')),
  added_by        uuid references public.profiles (id) on delete set null,
  last_read_at    timestamptz,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

-- Membership now covers groups too. Everything built on this (reading messages,
-- typing dots over Realtime, private photo links, reporting) works for groups.
create or replace function public.is_conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations c
                  where c.id = p_conversation and (select auth.uid()) in (c.user_a, c.user_b))
      or exists (select 1 from public.group_members g
                  where g.conversation_id = p_conversation and g.user_id = (select auth.uid()));
$$;

alter table public.group_members enable row level security;
revoke all on public.group_members from anon, authenticated;
grant select on public.group_members to authenticated;
create policy "group members: members see each other" on public.group_members for select to authenticated
  using ((select public.is_conversation_member(conversation_id)));
create policy "conversations: group members" on public.conversations for select to authenticated
  using (kind = 'group' and (select public.is_conversation_member(id)));

create function public.group_role(p_conversation uuid, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.group_members where conversation_id = p_conversation and user_id = p_user;
$$;

create function public.display_name_of(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select display_name from public.profiles where id = p_user), 'Someone');
$$;

-- A notice line in the group ("Ana added Ben"), sent as the person who did it.
create function public.post_group_notice(p_conversation uuid, p_actor uuid, p_text text) returns void
language sql security definer set search_path = '' as $$
  insert into public.messages (conversation_id, sender_id, body, kind)
  values (p_conversation, p_actor, left(p_text, 2000), 'system');
  update public.conversations
     set last_message_at = now(), last_sender_id = p_actor, last_preview = left(p_text, 120), last_kind = 'system'
   where id = p_conversation;
$$;

create function public.check_group_title(p_title text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_title, ''));
begin
  if char_length(v) < 1 then raise exception 'Give the group a name.' using errcode = '23514'; end if;
  if char_length(v) > 60 then raise exception 'Group names can be up to 60 characters.' using errcode = '23514'; end if;
  return v;
end $$;

-- Everyone in p_users must be a friend of p_by (and not blocked either way).
create function public.check_addable(p_by uuid, p_users uuid[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_m uuid;
begin
  foreach v_m in array p_users loop
    if not public.are_friends(p_by, v_m) or public.is_blocked_between(p_by, v_m)
       or not exists (select 1 from public.profiles where id = v_m and deleted_at is null) then
      raise exception 'You can only add your friends (people who follow you back).' using errcode = '42501';
    end if;
  end loop;
end $$;

create function public.create_group(p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := public.require_verified_user();
  v_title   text := public.check_group_title(p_title);
  v_members uuid[];
  v_id      uuid;
begin
  select coalesce(array_agg(distinct m), '{}') into v_members
    from unnest(coalesce(p_members, '{}'::uuid[])) m where m is not null and m <> v_uid;
  if cardinality(v_members) < 2 then
    raise exception 'Pick at least 2 friends for a group.' using errcode = '23514';
  end if;
  if cardinality(v_members) > 9 then
    raise exception 'Groups can have up to 10 people, including you.' using errcode = '23514';
  end if;
  perform public.check_addable(v_uid, v_members);
  if (select count(*) from public.conversations
       where kind = 'group' and created_by = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have started a lot of groups today. Try again tomorrow.' using errcode = '54000';
  end if;

  insert into public.conversations (kind, title, created_by, status) values ('group', v_title, v_uid, 'active')
  returning id into v_id;
  insert into public.group_members (conversation_id, user_id, role, added_by, last_read_at)
  values (v_id, v_uid, 'admin', v_uid, now());
  insert into public.group_members (conversation_id, user_id, role, added_by)
  select v_id, m, 'member', v_uid from unnest(v_members) m;
  perform public.post_group_notice(v_id, v_uid, public.display_name_of(v_uid) || ' started the group');
  return v_id;
end $$;

create function public.add_group_members(p_conversation uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_verified_user();
  v_role  text;
  v_new   uuid[];
  v_names text;
begin
  -- Lock the group so two admins adding at once can't go past the size limit.
  perform 1 from public.conversations where id = p_conversation and kind = 'group' for update;
  v_role := public.group_role(p_conversation, v_uid);
  if v_role is null then raise exception 'Group not found.' using errcode = 'P0002'; end if;
  if v_role <> 'admin' then raise exception 'Only group admins can add people.' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct m), '{}') into v_new
    from unnest(coalesce(p_members, '{}'::uuid[])) m
   where m is not null
     and not exists (select 1 from public.group_members g where g.conversation_id = p_conversation and g.user_id = m);
  if cardinality(v_new) = 0 then raise exception 'They are already in the group.' using errcode = '23514'; end if;
  if (select count(*) from public.group_members where conversation_id = p_conversation) + cardinality(v_new) > 10 then
    raise exception 'Groups can have up to 10 people.' using errcode = '23514';
  end if;
  perform public.check_addable(v_uid, v_new);
  insert into public.group_members (conversation_id, user_id, role, added_by)
  select p_conversation, m, 'member', v_uid from unnest(v_new) m;
  select string_agg(display_name, ', ' order by lower(display_name)) into v_names from public.profiles where id = any (v_new);
  perform public.post_group_notice(p_conversation, v_uid, public.display_name_of(v_uid) || ' added ' || v_names);
end $$;

-- Takes someone out of any call going on in the group (they just left or were removed).
create function public.drop_from_group_calls(p_conversation uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.call_participants p set state = 'left', left_at = now()
    from public.calls c
   where c.id = p.call_id and c.conversation_id = p_conversation and c.status in ('ringing', 'active')
     and p.user_id = p_user and p.state in ('ringing', 'joined');
  perform public.expire_stale_calls();
end $$;

create function public.remove_group_member(p_conversation uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_role text;
begin
  v_role := public.group_role(p_conversation, v_uid);
  if v_role is null then raise exception 'Group not found.' using errcode = 'P0002'; end if;
  if v_role <> 'admin' then raise exception 'Only group admins can remove people.' using errcode = '42501'; end if;
  if p_user = v_uid then raise exception 'Use Leave group to leave.' using errcode = '22023'; end if;
  if public.group_role(p_conversation, p_user) is null then
    raise exception 'They aren''t in this group.' using errcode = 'P0002';
  end if;
  if p_user = (select created_by from public.conversations where id = p_conversation) then
    raise exception 'The person who started the group can''t be removed.' using errcode = '42501';
  end if;
  delete from public.group_members where conversation_id = p_conversation and user_id = p_user;
  perform public.drop_from_group_calls(p_conversation, p_user);
  perform public.post_group_notice(p_conversation, v_uid,
    public.display_name_of(v_uid) || ' removed ' || public.display_name_of(p_user));
end $$;

create function public.leave_group(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_role text;
begin
  perform 1 from public.conversations where id = p_conversation and kind = 'group' for update;
  v_role := public.group_role(p_conversation, v_uid);
  if v_role is null then raise exception 'Group not found.' using errcode = 'P0002'; end if;
  delete from public.group_members where conversation_id = p_conversation and user_id = v_uid;
  perform public.drop_from_group_calls(p_conversation, v_uid);
  if not exists (select 1 from public.group_members where conversation_id = p_conversation) then
    return; -- the last person left; the empty group stays as a record but nobody can see it
  end if;
  -- A group always keeps an admin.
  if not exists (select 1 from public.group_members where conversation_id = p_conversation and role = 'admin') then
    update public.group_members set role = 'admin'
     where conversation_id = p_conversation
       and user_id = (select user_id from public.group_members where conversation_id = p_conversation
                       order by joined_at, user_id limit 1);
  end if;
  perform public.post_group_notice(p_conversation, v_uid, public.display_name_of(v_uid) || ' left the group');
end $$;

create function public.set_group_admin(p_conversation uuid, p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_target text; v_creator uuid;
begin
  perform 1 from public.conversations where id = p_conversation and kind = 'group' for update;
  if public.group_role(p_conversation, v_uid) is distinct from 'admin' then
    raise exception 'Only group admins can change admins.' using errcode = '42501';
  end if;
  v_target := public.group_role(p_conversation, p_user);
  if v_target is null then raise exception 'They aren''t in this group.' using errcode = 'P0002'; end if;
  if v_target = (case when p_admin then 'admin' else 'member' end) then return; end if;
  select created_by into v_creator from public.conversations where id = p_conversation;
  if not p_admin and p_user = v_creator and v_uid <> v_creator then
    raise exception 'The person who started the group stays an admin.' using errcode = '42501';
  end if;
  if not p_admin and (select count(*) from public.group_members where conversation_id = p_conversation and role = 'admin') <= 1 then
    raise exception 'A group needs at least one admin.' using errcode = '23514';
  end if;
  update public.group_members set role = case when p_admin then 'admin' else 'member' end
   where conversation_id = p_conversation and user_id = p_user;
  perform public.post_group_notice(p_conversation, v_uid,
    public.display_name_of(v_uid) || case when p_admin then ' made ' || public.display_name_of(p_user) || ' an admin'
                                          else ' removed ' || public.display_name_of(p_user) || ' as an admin' end);
end $$;

create function public.rename_group(p_conversation uuid, p_title text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_title text := public.check_group_title(p_title);
begin
  if public.group_role(p_conversation, v_uid) is distinct from 'admin' then
    raise exception 'Only group admins can rename the group.' using errcode = '42501';
  end if;
  update public.conversations set title = v_title where id = p_conversation and kind = 'group' and title <> v_title;
  if found then
    perform public.post_group_notice(p_conversation, v_uid, public.display_name_of(v_uid) || ' named the group "' || v_title || '"');
  end if;
end $$;

-- The people in a group (members only).
create function public.group_members_of(p_conversation uuid)
returns table (user_id uuid, username text, display_name text, avatar_path text, role text, is_creator boolean, is_friend boolean)
language sql stable security definer set search_path = '' as $$
  select g.user_id, p.username::text, p.display_name, p.avatar_path, g.role, g.user_id = c.created_by,
         public.are_friends((select auth.uid()), g.user_id)
    from public.group_members g
    join public.conversations c on c.id = g.conversation_id
    join public.profiles p on p.id = g.user_id
   where g.conversation_id = p_conversation and public.is_conversation_member(p_conversation)
   order by g.role = 'admin' desc, lower(p.display_name);
$$;

-- ═══════════════════════════════════════════════════════════════ inbox, sending, reading
-- my_conversations gains group rows (and new columns), so it is recreated.
drop function public.my_conversations();
create function public.my_conversations()
returns table (id uuid, other_id uuid, other_username text, other_display_name text, other_avatar_path text,
               status text, incoming_request boolean, last_message_at timestamptz, last_preview text,
               last_from_me boolean, unread int, is_friend boolean,
               kind text, member_count int, members jsonb, my_role text, last_sender_name text, last_kind text)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid)
  select * from (
    select c.id, p.id, p.username::text, p.display_name, p.avatar_path,
           c.status,
           c.status = 'request' and c.requested_by is distinct from me.uid,
           coalesce(c.last_message_at, c.created_at), c.last_preview, c.last_sender_id = me.uid,
           (select count(*)::int from public.messages m
             where m.conversation_id = c.id and m.sender_id <> me.uid and m.deleted_at is null
               and m.created_at > coalesce(case when c.user_a = me.uid then c.a_last_read_at else c.b_last_read_at end, '-infinity')),
           public.are_friends(me.uid, p.id),
           'direct'::text, 2, '[]'::jsonb, null::text, null::text, c.last_kind
      from public.conversations c
      cross join me
      join public.profiles p on p.id = case when c.user_a = me.uid then c.user_b else c.user_a end
     where c.kind = 'direct' and me.uid in (c.user_a, c.user_b)
       -- Empty chats only show for the person who opened them (the other side sees it once a message arrives).
       and (c.last_message_at is not null or c.requested_by = me.uid)
       -- A declined request disappears for the person who declined it.
       and not (c.status = 'declined' and c.requested_by is distinct from me.uid)
    union all
    select c.id, null::uuid, null::text, c.title, null::text,
           'active', false,
           coalesce(c.last_message_at, c.created_at), c.last_preview, c.last_sender_id = me.uid,
           (select count(*)::int from public.messages m
             where m.conversation_id = c.id and m.sender_id <> me.uid and m.deleted_at is null
               and m.created_at > coalesce(g.last_read_at, '-infinity')),
           false,
           'group'::text,
           (select count(*)::int from public.group_members x where x.conversation_id = c.id),
           (select coalesce(jsonb_agg(jsonb_build_object('username', q.username, 'display_name', q.display_name, 'avatar_path', q.avatar_path)), '[]'::jsonb)
              from (select pp.username::text as username, pp.display_name, pp.avatar_path
                      from public.group_members x join public.profiles pp on pp.id = x.user_id
                     where x.conversation_id = c.id and x.user_id <> me.uid
                     order by x.joined_at, x.user_id limit 3) q),
           g.role,
           (select pp.display_name from public.profiles pp where pp.id = c.last_sender_id),
           c.last_kind
      from public.group_members g
      cross join me
      join public.conversations c on c.id = g.conversation_id
     where g.user_id = me.uid and c.kind = 'group'
  ) rows
  order by 8 desc
  limit 200;
$$;
revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

create or replace function public.send_message(p_conversation uuid, p_body text, p_images jsonb default '[]')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_verified_user();
  v_c      record;
  v_other  uuid;
  v_body   text := btrim(coalesce(p_body, ''));
  v_images jsonb := coalesce(p_images, '[]');
  v_clean  jsonb := '[]';
  v_img    jsonb;
  v_id     uuid;
begin
  select * into v_c from public.conversations where id = p_conversation for update;
  if v_c.id is null or not public.is_conversation_member(v_c.id) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  if v_c.kind = 'direct' then
    v_other := case when v_c.user_a = v_uid then v_c.user_b else v_c.user_a end;
    if public.is_blocked_between(v_uid, v_other) then
      raise exception 'You can''t message this person.' using errcode = '42501';
    end if;
  end if;
  if jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) > 4 then
    raise exception 'A message can have up to 4 photos.' using errcode = '23514';
  end if;
  if char_length(v_body) < 1 and jsonb_array_length(v_images) = 0 then
    raise exception 'Write a message first.' using errcode = '23514';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'Messages can be up to 2,000 characters.' using errcode = '23514';
  end if;

  if v_c.kind = 'direct' then
    -- Becoming friends turns a request into a normal chat.
    if v_c.status <> 'active' and public.are_friends(v_uid, v_other) then
      update public.conversations set status = 'active' where id = v_c.id;
      v_c.status := 'active';
    end if;
    if v_c.status = 'declined' and v_c.requested_by = v_uid then
      raise exception 'This person isn''t accepting messages from you.' using errcode = '42501';
    end if;
    if v_c.status in ('request', 'declined') and v_c.requested_by is distinct from v_uid then
      -- The recipient replying accepts the request.
      update public.conversations set status = 'active' where id = v_c.id;
    elsif v_c.status = 'request'
          and (select count(*) from public.messages where conversation_id = v_c.id and sender_id = v_uid) >= 3 then
      raise exception 'You can send up to 3 messages until they accept your request.' using errcode = '54000';
    end if;
  end if;

  if (select count(*) from public.messages where sender_id = v_uid and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Slow down a little. Try again in a moment.' using errcode = '54000';
  end if;
  if (select count(*) from public.messages where sender_id = v_uid and created_at > now() - interval '1 day') >= 2000 then
    raise exception 'You have reached today''s message limit.' using errcode = '54000';
  end if;
  if v_c.kind = 'direct' and (select count(*) from public.conversations
       where requested_by = v_uid and status = 'request' and created_at > now() - interval '1 day') > 20 then
    raise exception 'You have sent a lot of message requests today. Try again tomorrow.' using errcode = '54000';
  end if;

  insert into public.messages (conversation_id, sender_id, body) values (v_c.id, v_uid, v_body) returning id into v_id;

  for v_img in select * from jsonb_array_elements(v_images) loop
    update public.message_images set message_id = v_id
     where path = v_img ->> 'path' and owner_id = v_uid and message_id is null
    returning jsonb_build_object('path', path, 'width', width, 'height', height) into v_img;
    if v_img is null then
      raise exception 'That photo isn''t yours or was already sent. Add it again.' using errcode = '42501';
    end if;
    v_clean := v_clean || jsonb_build_array(v_img);
  end loop;
  if jsonb_array_length(v_clean) > 0 then
    update public.messages set images = v_clean where id = v_id;
  end if;

  update public.conversations
     set last_message_at = now(), last_sender_id = v_uid, last_kind = 'text',
         last_preview = left(case when v_body <> '' then v_body else '📷 Photo' end, 120),
         a_last_read_at = case when user_a = v_uid then now() else a_last_read_at end,
         b_last_read_at = case when user_b = v_uid then now() else b_last_read_at end
   where id = v_c.id;
  if v_c.kind = 'group' then
    update public.group_members set last_read_at = now() where conversation_id = v_c.id and user_id = v_uid;
  end if;
  return v_id;
end $$;

create or replace function public.mark_conversation_read(p_conversation uuid) returns void
language sql security definer set search_path = '' as $$
  update public.conversations
     set a_last_read_at = case when user_a = (select auth.uid()) then now() else a_last_read_at end,
         b_last_read_at = case when user_b = (select auth.uid()) then now() else b_last_read_at end
   where id = p_conversation and kind = 'direct' and (select auth.uid()) in (user_a, user_b);
  update public.group_members set last_read_at = now()
   where conversation_id = p_conversation and user_id = (select auth.uid());
$$;

-- "Unsend" is for your own written messages; call summaries and group notices stay.
create or replace function public.delete_message(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  update public.messages set deleted_at = now(), body = '', images = '[]'
   where id = p_message and sender_id = v_uid and deleted_at is null and kind = 'text';
  if not found then raise exception 'Message not found.' using errcode = 'P0002'; end if;
end $$;

-- ═══════════════════════════════════════════════════════════════ group calls
alter table public.calls
  add column is_group boolean not null default false,
  alter column callee_id drop not null;
alter table public.calls add constraint calls_shape check ((is_group and callee_id is null) or (not is_group and callee_id is not null));

create table public.call_participants (
  call_id      uuid not null references public.calls (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  state        text not null default 'ringing' check (state in ('ringing', 'joined', 'left', 'declined', 'missed')),
  rung_at      timestamptz not null default now(),
  joined_at    timestamptz,
  left_at      timestamptz,
  last_seen_at timestamptz,
  primary key (call_id, user_id)
);
create index call_participants_user_idx on public.call_participants (user_id, state);
create index call_participants_live_idx on public.call_participants (state) where state in ('ringing', 'joined');

alter table public.call_participants enable row level security;
revoke all on public.call_participants from anon, authenticated;
grant select on public.call_participants to authenticated;
create policy "call participants: group members" on public.call_participants for select to authenticated
  using (exists (select 1 from public.calls c where c.id = call_id and public.is_conversation_member(c.conversation_id)));
create policy "calls: group members" on public.calls for select to authenticated
  using (is_group and (select public.is_conversation_member(conversation_id)));

-- In a call right now: a 1-to-1 call that is ringing or going, or a group call you have joined.
create function public.in_live_call(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.calls
                  where not is_group and status in ('ringing', 'active') and p_user in (caller_id, callee_id))
      or exists (select 1 from public.call_participants p join public.calls c on c.id = p.call_id
                  where p.user_id = p_user and p.state = 'joined' and c.status in ('ringing', 'active'));
$$;

-- Only the two people in a 1-to-1 call, or the people who joined a group call, may use its signalling channel.
create or replace function public.is_call_member(p_call uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.calls c
     where c.id = p_call
       and ((not c.is_group and (select auth.uid()) in (c.caller_id, c.callee_id))
            or (c.is_group and public.is_conversation_member(c.conversation_id)
                and exists (select 1 from public.call_participants p
                             where p.call_id = c.id and p.user_id = (select auth.uid()) and p.state = 'joined'))));
$$;

create or replace function public.log_call_message(p_call uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c record; v_text text; v_secs int;
begin
  select * into v_c from public.calls where id = p_call;
  v_secs := greatest(0, extract(epoch from (v_c.ended_at - v_c.answered_at))::int);
  v_text := case
    when v_c.is_group and v_c.answered_at is not null then
      (case when v_c.video then 'Group video call' else 'Group call' end) || ' · ' ||
      case when v_secs < 60 then v_secs || ' s' else (v_secs / 60) || ' min' end
    when v_c.is_group then 'Missed group call'
    when v_c.status = 'ended' and v_c.answered_at is not null then
      (case when v_c.video then 'Video call' else 'Call' end) || ' · ' ||
      case when v_secs < 60 then v_secs || ' s' else (v_secs / 60) || ' min' end
    when v_c.status = 'declined' then 'Call declined'
    else 'Missed call' end;
  insert into public.messages (conversation_id, sender_id, body, kind) values (v_c.conversation_id, v_c.caller_id, v_text, 'call');
  update public.conversations
     set last_message_at = now(), last_sender_id = v_c.caller_id, last_preview = '📞 ' || v_text, last_kind = 'call'
   where id = v_c.conversation_id;
end $$;

create or replace function public.expire_stale_calls() returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  -- Ringing that nobody answered (or, in a group, that nobody joined) within 45 s.
  for v_id in
    update public.calls set status = 'missed', ended_at = now()
     where status = 'ringing' and created_at < now() - interval '45 seconds'
    returning id
  loop
    perform public.log_call_message(v_id);
  end loop;
  -- Group members who didn't pick up stop ringing after 45 s.
  update public.call_participants set state = 'missed'
   where state = 'ringing' and rung_at < now() - interval '45 seconds';
  -- People whose browser stopped checking in (closed tab, lost connection) are out of the call.
  update public.call_participants set state = 'left', left_at = now()
   where state = 'joined' and coalesce(last_seen_at, joined_at) < now() - interval '90 seconds';
  -- A group call ends when nobody is left in it.
  for v_id in
    update public.calls c set status = case when c.answered_at is not null then 'ended' else 'missed' end, ended_at = now()
     where c.is_group and c.status in ('ringing', 'active')
       and not exists (select 1 from public.call_participants p where p.call_id = c.id and p.state = 'joined')
    returning c.id
  loop
    perform public.log_call_message(v_id);
  end loop;
  -- A call left "active" for 6 hours (every tab crashed) is closed.
  update public.calls set status = 'ended', ended_at = now()
   where status = 'active' and answered_at < now() - interval '6 hours';
  -- Nobody stays "in" a call that is over.
  update public.call_participants p set state = case when p.state = 'joined' then 'left' else 'missed' end, left_at = now()
    from public.calls c
   where c.id = p.call_id and p.state in ('ringing', 'joined') and c.status not in ('ringing', 'active');
end $$;

-- 1-to-1 calls now also count group calls when checking "already in a call".
create or replace function public.start_call(p_conversation uuid, p_video boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_verified_user();
  v_c     record;
  v_other uuid;
  v_id    uuid;
begin
  perform public.expire_stale_calls();
  select * into v_c from public.conversations where id = p_conversation;
  if v_c.id is null or v_c.kind <> 'direct' or v_uid not in (v_c.user_a, v_c.user_b) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  v_other := case when v_c.user_a = v_uid then v_c.user_b else v_c.user_a end;
  if not public.are_friends(v_uid, v_other) then
    raise exception 'You can call friends only (people who follow you back).' using errcode = '42501';
  end if;
  if public.is_blocked_between(v_uid, v_other) then
    raise exception 'You can''t call this person.' using errcode = '42501';
  end if;
  if public.in_live_call(v_uid) then
    raise exception 'You are already in a call.' using errcode = '54000';
  end if;
  if public.in_live_call(v_other) then
    raise exception 'They are on another call. Try again in a bit.' using errcode = '54000';
  end if;
  if (select count(*) from public.calls where caller_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many calls in the last hour. Try again later.' using errcode = '54000';
  end if;
  insert into public.calls (conversation_id, caller_id, callee_id, video)
  values (p_conversation, v_uid, v_other, coalesce(p_video, false)) returning id into v_id;
  return v_id;
end $$;

-- Join a group call. Returns 'joined', 'full' (6 people already) or 'ended'.
-- Not errors, so the lazy expiry above isn't rolled back.
create function public.join_group_call(p_call uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user(); v_c record;
begin
  perform public.expire_stale_calls();
  select * into v_c from public.calls where id = p_call and is_group for update;
  if v_c.id is null or public.group_role(v_c.conversation_id, v_uid) is null then
    raise exception 'Call not found.' using errcode = 'P0002';
  end if;
  if v_c.status not in ('ringing', 'active') then return 'ended'; end if;
  if exists (select 1 from public.call_participants where call_id = p_call and user_id = v_uid and state = 'joined') then
    update public.call_participants set last_seen_at = now() where call_id = p_call and user_id = v_uid;
    return 'joined';
  end if;
  if public.in_live_call(v_uid) then
    raise exception 'You are already in a call.' using errcode = '54000';
  end if;
  if (select count(*) from public.call_participants where call_id = p_call and state = 'joined') >= 6 then
    return 'full';
  end if;
  insert into public.call_participants (call_id, user_id, state, joined_at, last_seen_at)
  values (p_call, v_uid, 'joined', now(), now())
  on conflict (call_id, user_id) do update set state = 'joined', joined_at = now(), left_at = null, last_seen_at = now();
  if v_c.status = 'ringing' then
    update public.calls set status = 'active', answered_at = now() where id = p_call;
  end if;
  return 'joined';
end $$;

-- Start a call in a group (everyone else rings). If one is already going, you join it instead.
create function public.start_group_call(p_conversation uuid, p_video boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user(); v_live uuid; v_id uuid; v_r text;
begin
  perform public.expire_stale_calls();
  -- Lock the group so two people pressing Call at once end up in the same call.
  perform 1 from public.conversations where id = p_conversation and kind = 'group' for update;
  if public.group_role(p_conversation, v_uid) is null then
    raise exception 'Group not found.' using errcode = 'P0002';
  end if;
  select id into v_live from public.calls
   where conversation_id = p_conversation and is_group and status in ('ringing', 'active')
   order by created_at desc limit 1;
  if v_live is not null then
    v_r := public.join_group_call(v_live);
    if v_r = 'full' then raise exception 'This call is full (6 people).' using errcode = '54000'; end if;
    return v_live;
  end if;
  if public.in_live_call(v_uid) then
    raise exception 'You are already in a call.' using errcode = '54000';
  end if;
  if (select count(*) from public.calls where caller_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many calls in the last hour. Try again later.' using errcode = '54000';
  end if;
  insert into public.calls (conversation_id, caller_id, callee_id, video, is_group)
  values (p_conversation, v_uid, null, coalesce(p_video, false), true) returning id into v_id;
  insert into public.call_participants (call_id, user_id, state, joined_at, last_seen_at)
  values (v_id, v_uid, 'joined', now(), now());
  insert into public.call_participants (call_id, user_id, state)
  select v_id, g.user_id, 'ringing' from public.group_members g
   where g.conversation_id = p_conversation and g.user_id <> v_uid;
  return v_id;
end $$;

create function public.decline_group_call(p_call uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  update public.call_participants set state = 'declined'
   where call_id = p_call and user_id = v_uid and state = 'ringing';
end $$;

-- Leave a group call; the last person out ends it.
create function public.leave_group_call(p_call uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  perform 1 from public.calls where id = p_call and is_group for update;
  update public.call_participants set state = 'left', left_at = now()
   where call_id = p_call and user_id = v_uid and state in ('joined', 'ringing');
  perform public.expire_stale_calls();
end $$;

-- end_call (also used by the "tab closed" beacon) works for group calls too.
create or replace function public.end_call(p_call uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_status text;
begin
  if exists (select 1 from public.calls where id = p_call and is_group) then
    perform public.leave_group_call(p_call);
    return;
  end if;
  select status into v_status from public.calls where id = p_call and v_uid in (caller_id, callee_id) for update;
  if v_status is null then raise exception 'Call not found.' using errcode = 'P0002'; end if;
  if v_status not in ('ringing', 'active') then return; end if; -- already over (the other side hung up first)
  update public.calls set status = case when v_status = 'active' then 'ended' else 'missed' end, ended_at = now()
   where id = p_call;
  perform public.log_call_message(p_call);
end $$;

-- Each browser in a group call checks in every few seconds. Returns the call's
-- status and who is in it, or null if you can't see the call.
create function public.group_call_pulse(p_call uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_c record;
begin
  update public.call_participants set last_seen_at = now()
   where call_id = p_call and user_id = v_uid and state = 'joined';
  perform public.expire_stale_calls();
  select * into v_c from public.calls where id = p_call and is_group;
  if v_c.id is null or not public.is_conversation_member(v_c.conversation_id) then return null; end if;
  return jsonb_build_object(
    'status', v_c.status,
    'participants', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'username', pr.username::text,
                                                   'display_name', pr.display_name, 'avatar_path', pr.avatar_path)
                                order by p.joined_at), '[]'::jsonb)
        from public.call_participants p join public.profiles pr on pr.id = p.user_id
       where p.call_id = p_call and p.state = 'joined'));
end $$;

-- The call going on in a group right now, if any (for the "Join" bar in the chat).
create function public.live_group_call(p_conversation uuid)
returns table (id uuid, video boolean, joined int, started_by text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_conversation_member(p_conversation) then return; end if;
  perform public.expire_stale_calls();
  return query
    select c.id, c.video,
           (select count(*)::int from public.call_participants p where p.call_id = c.id and p.state = 'joined'),
           pr.display_name
      from public.calls c join public.profiles pr on pr.id = c.caller_id
     where c.conversation_id = p_conversation and c.is_group and c.status in ('ringing', 'active')
     order by c.created_at desc limit 1;
end $$;

-- Calls ringing for you: 1-to-1, or a group call you haven't answered yet.
drop function public.my_incoming_call();
create function public.my_incoming_call()
returns table (id uuid, conversation_id uuid, caller_id uuid, video boolean, created_at timestamptz,
               caller_username text, caller_display_name text, caller_avatar_path text,
               is_group boolean, group_title text)
language sql security definer set search_path = '' as $$
  select * from (
    select c.id, c.conversation_id, c.caller_id, c.video, c.created_at, p.username::text, p.display_name, p.avatar_path,
           false, null::text
      from public.calls c join public.profiles p on p.id = c.caller_id
     where not c.is_group and c.callee_id = (select auth.uid()) and c.status = 'ringing'
       and c.created_at > now() - interval '45 seconds'
    union all
    select c.id, c.conversation_id, c.caller_id, c.video, cp.rung_at, p.username::text, p.display_name, p.avatar_path,
           true, g.title
      from public.call_participants cp
      join public.calls c on c.id = cp.call_id
      join public.conversations g on g.id = c.conversation_id
      join public.profiles p on p.id = c.caller_id
     where cp.user_id = (select auth.uid()) and cp.state = 'ringing' and c.status in ('ringing', 'active')
       and cp.rung_at > now() - interval '45 seconds'
       and public.group_role(c.conversation_id, (select auth.uid())) is not null
  ) rows
  order by 5 desc limit 1;
$$;

-- ═══════════════════════════════════════════════════════════════ privileges
revoke execute on function public.group_role(uuid, uuid), public.display_name_of(uuid),
  public.post_group_notice(uuid, uuid, text), public.check_group_title(text), public.check_addable(uuid, uuid[]),
  public.drop_from_group_calls(uuid, uuid), public.in_live_call(uuid)
  from public, anon, authenticated;
revoke execute on function public.create_group(text, uuid[]), public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid), public.leave_group(uuid), public.set_group_admin(uuid, uuid, boolean),
  public.rename_group(uuid, text), public.group_members_of(uuid),
  public.join_group_call(uuid), public.start_group_call(uuid, boolean), public.decline_group_call(uuid),
  public.leave_group_call(uuid), public.group_call_pulse(uuid), public.live_group_call(uuid), public.my_incoming_call()
  from public, anon;
grant execute on function public.create_group(text, uuid[]), public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid), public.leave_group(uuid), public.set_group_admin(uuid, uuid, boolean),
  public.rename_group(uuid, text), public.group_members_of(uuid),
  public.join_group_call(uuid), public.start_group_call(uuid, boolean), public.decline_group_call(uuid),
  public.leave_group_call(uuid), public.group_call_pulse(uuid), public.live_group_call(uuid), public.my_incoming_call()
  to authenticated;

-- Realtime: group members hear when a call starts ringing for them, and when the call changes.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.call_participants;
  end if;
end $$;
