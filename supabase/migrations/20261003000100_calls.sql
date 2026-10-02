-- Voice and video calls (1-to-1, friends only).
--
-- The audio and video go directly between the two browsers (WebRTC); this
-- database only keeps track of the call: who rang whom, whether it was
-- answered, and how long it lasted. Rules, enforced here:
--   * only friends (mutual follows) can ring each other, never across a block;
--   * one call at a time: ringing someone who is already in a call says "busy";
--   * only the person being rung can answer or decline, and only for 45 seconds;
--   * either person can hang up; a summary ("Missed call", "Call · 3 min") is
--     added to their chat.
-- The connection details (offer/answer/network candidates) are exchanged over a
-- private Realtime channel only the two people in the call may join.

alter table public.messages add column kind text not null default 'text' check (kind in ('text', 'call'));

create table public.calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  caller_id       uuid not null references public.profiles (id) on delete cascade,
  callee_id       uuid not null references public.profiles (id) on delete cascade,
  video           boolean not null default false,
  status          text not null default 'ringing' check (status in ('ringing', 'active', 'ended', 'missed', 'declined')),
  created_at      timestamptz not null default now(),
  answered_at     timestamptz,
  ended_at        timestamptz
);
create index calls_callee_idx on public.calls (callee_id, created_at desc);
create index calls_caller_idx on public.calls (caller_id, created_at desc);
create index calls_live_idx on public.calls (status) where status in ('ringing', 'active');

alter table public.calls enable row level security;
revoke all on public.calls from anon, authenticated;
grant select on public.calls to authenticated;
create policy "calls: the two people" on public.calls for select to authenticated
  using ((select auth.uid()) in (caller_id, callee_id));

create function public.is_call_member(p_call uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.calls c where c.id = p_call and (select auth.uid()) in (c.caller_id, c.callee_id));
$$;

-- Adds the call summary to the chat, from the caller.
create function public.log_call_message(p_call uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c record; v_text text; v_secs int;
begin
  select * into v_c from public.calls where id = p_call;
  v_secs := greatest(0, extract(epoch from (v_c.ended_at - v_c.answered_at))::int);
  v_text := case
    when v_c.status = 'ended' and v_c.answered_at is not null then
      (case when v_c.video then 'Video call' else 'Call' end) || ' · ' ||
      case when v_secs < 60 then v_secs || ' s' else (v_secs / 60) || ' min' end
    when v_c.status = 'declined' then 'Call declined'
    else 'Missed call' end;
  insert into public.messages (conversation_id, sender_id, body, kind) values (v_c.conversation_id, v_c.caller_id, v_text, 'call');
  update public.conversations
     set last_message_at = now(), last_sender_id = v_c.caller_id, last_preview = '📞 ' || v_text
   where id = v_c.conversation_id;
end $$;

-- Ringing that nobody answered within 45 s becomes "missed" (checked lazily, whenever calls are
-- touched) and gets its "Missed call" line in the chat.
create function public.expire_stale_calls() returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in
    update public.calls set status = 'missed', ended_at = now()
     where status = 'ringing' and created_at < now() - interval '45 seconds'
    returning id
  loop
    perform public.log_call_message(v_id);
  end loop;
  -- A call left "active" for 6 hours (both tabs crashed) is closed.
  update public.calls set status = 'ended', ended_at = now()
   where status = 'active' and answered_at < now() - interval '6 hours';
end $$;

create function public.start_call(p_conversation uuid, p_video boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_verified_user();
  v_c     record;
  v_other uuid;
  v_id    uuid;
begin
  perform public.expire_stale_calls();
  select * into v_c from public.conversations where id = p_conversation;
  if v_c.id is null or v_uid not in (v_c.user_a, v_c.user_b) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  v_other := case when v_c.user_a = v_uid then v_c.user_b else v_c.user_a end;
  if not public.are_friends(v_uid, v_other) then
    raise exception 'You can call friends only (people who follow you back).' using errcode = '42501';
  end if;
  if public.is_blocked_between(v_uid, v_other) then
    raise exception 'You can''t call this person.' using errcode = '42501';
  end if;
  if exists (select 1 from public.calls where status in ('ringing', 'active') and v_uid in (caller_id, callee_id)) then
    raise exception 'You are already in a call.' using errcode = '54000';
  end if;
  if exists (select 1 from public.calls where status in ('ringing', 'active') and v_other in (caller_id, callee_id)) then
    raise exception 'They are on another call. Try again in a bit.' using errcode = '54000';
  end if;
  if (select count(*) from public.calls where caller_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many calls in the last hour. Try again later.' using errcode = '54000';
  end if;
  insert into public.calls (conversation_id, caller_id, callee_id, video)
  values (p_conversation, v_uid, v_other, coalesce(p_video, false)) returning id into v_id;
  return v_id;
end $$;

-- Returns 'answered', or 'ended' when the call is already over (rang out, cancelled).
-- Not an error, so the expiry above isn't rolled back.
create function public.answer_call(p_call uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  perform public.expire_stale_calls();
  update public.calls set status = 'active', answered_at = now()
   where id = p_call and callee_id = v_uid and status = 'ringing';
  return case when found then 'answered' else 'ended' end;
end $$;

create function public.decline_call(p_call uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  update public.calls set status = 'declined', ended_at = now()
   where id = p_call and callee_id = v_uid and status = 'ringing';
  if not found then raise exception 'That call has ended.' using errcode = 'P0002'; end if;
  perform public.log_call_message(p_call);
end $$;

-- Either person hangs up. A caller cancelling while it rings makes it a missed call.
create function public.end_call(p_call uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_status text;
begin
  select status into v_status from public.calls where id = p_call and v_uid in (caller_id, callee_id) for update;
  if v_status is null then raise exception 'Call not found.' using errcode = 'P0002'; end if;
  if v_status not in ('ringing', 'active') then return; end if; -- already over (the other side hung up first)
  update public.calls set status = case when v_status = 'active' then 'ended' else 'missed' end, ended_at = now()
   where id = p_call;
  perform public.log_call_message(p_call);
end $$;

-- A call that's ringing for you right now (in case the live "ring" was missed, e.g. on page load).
create function public.my_incoming_call()
returns table (id uuid, conversation_id uuid, caller_id uuid, video boolean, created_at timestamptz,
               caller_username text, caller_display_name text, caller_avatar_path text)
language sql security definer set search_path = '' as $$
  select c.id, c.conversation_id, c.caller_id, c.video, c.created_at, p.username::text, p.display_name, p.avatar_path
    from public.calls c join public.profiles p on p.id = c.caller_id
   where c.callee_id = (select auth.uid()) and c.status = 'ringing' and c.created_at > now() - interval '45 seconds'
   order by c.created_at desc limit 1;
$$;

revoke execute on function public.expire_stale_calls(), public.log_call_message(uuid) from public, anon, authenticated;
revoke execute on function public.start_call(uuid, boolean), public.answer_call(uuid), public.decline_call(uuid),
  public.end_call(uuid), public.my_incoming_call(), public.is_call_member(uuid) from public, anon;
grant execute on function public.start_call(uuid, boolean), public.answer_call(uuid), public.decline_call(uuid),
  public.end_call(uuid), public.my_incoming_call(), public.is_call_member(uuid) to authenticated;

-- Realtime: the person being rung hears about the new call instantly, and call
-- set-up messages go over a private channel only the two people may join.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.calls;
  end if;
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy "calls: the two people only" on realtime.messages for all to authenticated
        using (realtime.topic() like 'call:%'
               and public.is_call_member(nullif(substring(realtime.topic() from 6), '')::uuid))
        with check (realtime.topic() like 'call:%'
               and public.is_call_member(nullif(substring(realtime.topic() from 6), '')::uuid))
    $p$;
  end if;
end $$;
