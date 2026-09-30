-- Direct messages (1-to-1).
--
-- Who can message whom:
--   * Friends (mutual follows) chat freely.
--   * Anyone else starts a message request. The recipient sees it under
--     Requests and can accept (or simply reply) or decline. Until then the sender
--     can send at most 3 messages; after a decline they can't send any more.
--   * Blocking stops both people from messaging each other, either way.
--
-- Privacy:
--   * Only the two people in a conversation can read it (RLS), including over
--     Realtime. Nobody writes to the tables directly; everything goes through
--     the functions below, which check membership, blocks, requests and limits.
--   * Photos live in the PRIVATE file bucket and are shown through short-lived
--     signed links, never the public media bucket.
--   * Moderators can read a message only when it has been reported.
--   * Deleting ("unsend") keeps the row with an empty body, so a report about it
--     can still be judged by the snapshot taken at report time.

-- (The 'message' report type is added in 20261001000050.)

create table public.user_blocks (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
grant select on public.user_blocks to authenticated;
create policy "blocks: read own" on public.user_blocks for select to authenticated
  using (user_id = (select auth.uid()));

create function public.is_blocked_between(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_blocks
                  where (user_id = p_a and blocked_id = p_b) or (user_id = p_b and blocked_id = p_a));
$$;

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles (id) on delete cascade,
  user_b          uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'active' check (status in ('active', 'request', 'declined')),
  requested_by    uuid references public.profiles (id) on delete set null,
  a_last_read_at  timestamptz,
  b_last_read_at  timestamptz,
  last_message_at timestamptz,
  last_sender_id  uuid,
  last_preview    text check (char_length(last_preview) <= 120),
  created_at      timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index conversations_a_idx on public.conversations (user_a, last_message_at desc);
create index conversations_b_idx on public.conversations (user_b, last_message_at desc);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null default '' check (char_length(body) <= 2000),
  images          jsonb not null default '[]',
  deleted_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index messages_sender_idx on public.messages (sender_id, created_at desc);

-- Photos waiting to be sent (paths issued by the server; attached by send_message).
create table public.message_images (
  path       text primary key,
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  width      integer check (width between 1 and 10000),
  height     integer check (height between 1 and 10000),
  created_at timestamptz not null default now()
);
create index message_images_owner_idx on public.message_images (owner_id, created_at);

create function public.is_conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations c
                  where c.id = p_conversation and (select auth.uid()) in (c.user_a, c.user_b));
$$;

-- ═══════════════════════════════════════════════════════════════ access
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_images enable row level security;
revoke all on public.conversations, public.messages, public.message_images from anon, authenticated;
grant select on public.conversations, public.messages to authenticated;
create policy "conversations: members" on public.conversations for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));
create policy "messages: members" on public.messages for select to authenticated
  using ((select public.is_conversation_member(conversation_id)));
-- message_images: no client access at all; the server signs photo links after checking membership.

-- ═══════════════════════════════════════════════════════════════ reads
-- Your conversations with the other person, the request state and your unread count.
create function public.my_conversations()
returns table (id uuid, other_id uuid, other_username text, other_display_name text, other_avatar_path text,
               status text, incoming_request boolean, last_message_at timestamptz, last_preview text,
               last_from_me boolean, unread int, is_friend boolean)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid)
  select c.id, p.id, p.username::text, p.display_name, p.avatar_path,
         c.status,
         c.status = 'request' and c.requested_by is distinct from me.uid,
         c.last_message_at, c.last_preview, c.last_sender_id = me.uid,
         (select count(*)::int from public.messages m
           where m.conversation_id = c.id and m.sender_id <> me.uid and m.deleted_at is null
             and m.created_at > coalesce(case when c.user_a = me.uid then c.a_last_read_at else c.b_last_read_at end, '-infinity')),
         public.are_friends(me.uid, p.id)
    from public.conversations c
    cross join me
    join public.profiles p on p.id = case when c.user_a = me.uid then c.user_b else c.user_a end
   where me.uid in (c.user_a, c.user_b)
     -- Empty chats only show for the person who opened them (the other side sees it once a message arrives).
     and (c.last_message_at is not null or c.requested_by = me.uid)
     -- A declined request disappears for the person who declined it.
     and not (c.status = 'declined' and c.requested_by is distinct from me.uid)
   order by coalesce(c.last_message_at, c.created_at) desc
   limit 200;
$$;

-- Unread messages in accepted chats, for the header badge (requests are counted separately in the inbox).
create function public.my_unread_messages() returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(unread), 0)::int from public.my_conversations() where status = 'active';
$$;

-- ═══════════════════════════════════════════════════════════════ writes
create function public.start_conversation(p_other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_verified_user();
  v_a uuid; v_b uuid; v_id uuid; v_c record;
begin
  if p_other is null or p_other = v_uid then
    raise exception 'You can''t message yourself.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_other and deleted_at is null) then
    raise exception 'That account doesn''t exist.' using errcode = 'P0002';
  end if;
  if public.is_blocked_between(v_uid, p_other) then
    raise exception 'You can''t message this person.' using errcode = '42501';
  end if;
  v_a := least(v_uid, p_other); v_b := greatest(v_uid, p_other);
  select * into v_c from public.conversations where user_a = v_a and user_b = v_b;
  if v_c.id is not null then return v_c.id; end if;
  insert into public.conversations (user_a, user_b, status, requested_by)
  values (v_a, v_b, case when public.are_friends(v_uid, p_other) then 'active' else 'request' end, v_uid)
  returning id into v_id;
  return v_id;
end $$;

create function public.send_message(p_conversation uuid, p_body text, p_images jsonb default '[]')
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
  if v_c.id is null or v_uid not in (v_c.user_a, v_c.user_b) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  v_other := case when v_c.user_a = v_uid then v_c.user_b else v_c.user_a end;
  if public.is_blocked_between(v_uid, v_other) then
    raise exception 'You can''t message this person.' using errcode = '42501';
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

  if (select count(*) from public.messages where sender_id = v_uid and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Slow down a little. Try again in a moment.' using errcode = '54000';
  end if;
  if (select count(*) from public.messages where sender_id = v_uid and created_at > now() - interval '1 day') >= 2000 then
    raise exception 'You have reached today''s message limit.' using errcode = '54000';
  end if;
  if (select count(*) from public.conversations
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
     set last_message_at = now(), last_sender_id = v_uid,
         last_preview = left(case when v_body <> '' then v_body else '📷 Photo' end, 120),
         a_last_read_at = case when user_a = v_uid then now() else a_last_read_at end,
         b_last_read_at = case when user_b = v_uid then now() else b_last_read_at end
   where id = v_c.id;
  return v_id;
end $$;

create function public.respond_to_request(p_conversation uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_c record;
begin
  select * into v_c from public.conversations where id = p_conversation for update;
  if v_c.id is null or v_uid not in (v_c.user_a, v_c.user_b) or v_c.requested_by = v_uid or v_c.status = 'active' then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  update public.conversations set status = case when p_accept then 'active' else 'declined' end where id = v_c.id;
end $$;

create function public.mark_conversation_read(p_conversation uuid) returns void
language sql security definer set search_path = '' as $$
  update public.conversations
     set a_last_read_at = case when user_a = (select auth.uid()) then now() else a_last_read_at end,
         b_last_read_at = case when user_b = (select auth.uid()) then now() else b_last_read_at end
   where id = p_conversation and (select auth.uid()) in (user_a, user_b);
$$;

-- "Unsend": the sender can delete their own message for both people.
create function public.delete_message(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  update public.messages set deleted_at = now(), body = '', images = '[]'
   where id = p_message and sender_id = v_uid and deleted_at is null;
  if not found then raise exception 'Message not found.' using errcode = 'P0002'; end if;
end $$;

create function public.set_block(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if p_user = v_uid then raise exception 'You can''t block yourself.' using errcode = '22023'; end if;
  if p_on then
    insert into public.user_blocks (user_id, blocked_id) values (v_uid, p_user) on conflict do nothing;
  else
    delete from public.user_blocks where user_id = v_uid and blocked_id = p_user;
  end if;
end $$;

-- A photo slot for a message. The server uploads the bytes after checking they
-- really are an image; this only issues the path and enforces the limits.
create function public.prepare_message_image(p_ext text, p_width int, p_height int) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user(); v_path text;
begin
  if p_ext not in ('png', 'jpg', 'webp', 'gif') then
    raise exception 'Use a PNG, JPG, WebP or GIF image' using errcode = '22023';
  end if;
  if (select count(*) from public.message_images where owner_id = v_uid and created_at > now() - interval '1 day') >= 100 then
    raise exception 'You have reached today''s photo limit.' using errcode = '54000';
  end if;
  v_path := 'dm/' || v_uid::text || '/' || gen_random_uuid()::text || '.' || p_ext;
  insert into public.message_images (path, owner_id, width, height)
  values (v_path, v_uid, case when p_width between 1 and 10000 then p_width end, case when p_height between 1 and 10000 then p_height end);
  return v_path;
end $$;

-- Which of these photo paths the caller may see (they're in a conversation of theirs).
create function public.visible_message_images(p_paths text[]) returns setof text
language sql stable security definer set search_path = '' as $$
  select i.path from public.message_images i
    join public.messages m on m.id = i.message_id and m.deleted_at is null
   where i.path = any (p_paths[1:200]) and public.is_conversation_member(m.conversation_id);
$$;

-- Moderators can read a message only once someone in the conversation reported it.
create function public.reported_messages(p_ids uuid[])
returns table (id uuid, body text, sender_username text, deleted boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, m.body, p.username::text, m.deleted_at is not null, m.created_at
    from public.messages m join public.profiles p on p.id = m.sender_id
   where public.is_moderator() and m.id = any (p_ids)
     and exists (select 1 from public.reports r where r.target_type = 'message' and r.target_id = m.id);
$$;

-- Only people in the conversation may report its messages.
create function public.guard_message_reports() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.target_type = 'message' and not exists (
       select 1 from public.messages m where m.id = new.target_id and public.is_conversation_member(m.conversation_id)) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  return new;
end $$;
create trigger reports_guard_messages before insert on public.reports
  for each row execute function public.guard_message_reports();

revoke execute on function public.is_blocked_between(uuid, uuid), public.guard_message_reports() from public, anon, authenticated;
revoke execute on function public.my_conversations(), public.my_unread_messages(), public.start_conversation(uuid),
  public.send_message(uuid, text, jsonb), public.respond_to_request(uuid, boolean), public.mark_conversation_read(uuid),
  public.delete_message(uuid), public.set_block(uuid, boolean), public.prepare_message_image(text, int, int),
  public.visible_message_images(text[]), public.reported_messages(uuid[]), public.is_conversation_member(uuid)
  from public, anon;
grant execute on function public.my_conversations(), public.my_unread_messages(), public.start_conversation(uuid),
  public.send_message(uuid, text, jsonb), public.respond_to_request(uuid, boolean), public.mark_conversation_read(uuid),
  public.delete_message(uuid), public.set_block(uuid, boolean), public.prepare_message_image(text, int, int),
  public.visible_message_images(text[]), public.reported_messages(uuid[]), public.is_conversation_member(uuid)
  to authenticated;

-- ═══════════════════════════════════════════════════════════════ realtime
-- New messages are pushed to the two members (Realtime applies the RLS above),
-- and typing dots go over a private channel only the two members may join.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'realtime')
     and to_regclass('realtime.messages') is not null then
    execute $p$
      create policy "dm typing: members only" on realtime.messages for all to authenticated
        using (realtime.topic() like 'dm:%'
               and public.is_conversation_member(nullif(substring(realtime.topic() from 4), '')::uuid))
        with check (realtime.topic() like 'dm:%'
               and public.is_conversation_member(nullif(substring(realtime.topic() from 4), '')::uuid))
    $p$;
  end if;
end $$;
