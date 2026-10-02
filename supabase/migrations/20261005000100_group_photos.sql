-- Group photos.
--
-- Admins can give a group a picture. The browser crops and shrinks it, then
-- uploads it into the uploader's own folder of the public avatars bucket (the
-- same place and rules as profile photos). set_group_photo only accepts a path
-- in the caller's own folder that really exists, so nobody can point a group at
-- someone else's file. Changing or removing it adds a notice to the chat.

alter table public.conversations
  add column photo_path text check (photo_path ~ '^[0-9a-f-]{36}/group-[a-z0-9]{8,32}[.](webp|jpg)$');

create function public.set_group_photo(p_conversation uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if public.group_role(p_conversation, v_uid) is distinct from 'admin' then
    raise exception 'Only group admins can change the group photo.' using errcode = '42501';
  end if;
  if p_path is not null then
    if p_path !~ ('^' || v_uid::text || '/group-[a-z0-9]{8,32}[.](webp|jpg)$') then
      raise exception 'Invalid image.' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = p_path) then
      raise exception 'Upload the photo first.' using errcode = 'P0002';
    end if;
  end if;
  update public.conversations set photo_path = p_path
   where id = p_conversation and kind = 'group' and photo_path is distinct from p_path;
  if found then
    perform public.post_group_notice(p_conversation, v_uid,
      public.display_name_of(v_uid) || case when p_path is null then ' removed the group photo' else ' changed the group photo' end);
  end if;
end $$;
revoke execute on function public.set_group_photo(uuid, text) from public, anon;
grant execute on function public.set_group_photo(uuid, text) to authenticated;

create or replace function public.my_conversations()
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
    select c.id, null::uuid, null::text, c.title, c.photo_path,
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
