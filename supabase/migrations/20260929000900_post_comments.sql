-- Comments on community posts. Flat (no threads), plain text, up to 800 characters.
--
-- Same access model as posts: everyone reads published comments, nobody writes
-- to the tables directly (create_post_comment / delete_post_comment do it, with
-- the checks and limits), and a removed comment is hidden rather than erased so
-- a report about it can still be judged.

alter type public.report_target add value if not exists 'post_comment';

create table public.post_comments (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.posts (id) on delete cascade,
  author_id      uuid not null references public.profiles (id) on delete cascade,
  body           text not null check (char_length(btrim(body)) between 1 and 800),
  status         text not null default 'published' check (status in ('published', 'removed')),
  removed_by     uuid references public.profiles (id) on delete set null,
  removed_reason text check (char_length(removed_reason) <= 500),
  removed_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index post_comments_post_idx   on public.post_comments (post_id, created_at) where status = 'published';
create index post_comments_author_idx on public.post_comments (author_id, created_at desc);

alter table public.posts add column comment_count integer not null default 0 check (comment_count >= 0);

-- The counter lives on the post so the feed reads one table.
create function public.bump_post_comments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status = 'published' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
  elsif tg_op = 'UPDATE' and old.status = 'published' and new.status = 'removed' then
    update public.posts set comment_count = greatest(comment_count - 1, 0) where id = new.post_id;
  elsif tg_op = 'DELETE' and old.status = 'published' then
    update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;
create trigger post_comments_count after insert or update of status or delete on public.post_comments
  for each row execute function public.bump_post_comments();

-- ═══════════════════════════════════════════════════════════════ access
revoke all on public.post_comments from anon, authenticated;
alter table public.post_comments enable row level security;

grant select on public.post_comments to anon, authenticated;
create policy "post comments: published, or yours, or moderator" on public.post_comments for select
  using (status = 'published' or author_id = (select auth.uid()) or (select public.is_moderator()));

-- ═══════════════════════════════════════════════════════════════ reads
-- Same view as before, with comment_count appended (create or replace can only add columns at the end).
create or replace view public.post_cards with (security_invoker = true) as
select po.id, po.body, po.tags, po.like_count, po.created_at, po.author_id,
       p.username::text as author_username, p.display_name as author_display_name, p.avatar_path as author_avatar_path,
       po.comment_count
  from public.posts po
  join public.profiles p on p.id = po.author_id
 where po.status = 'published';

create view public.post_comment_cards with (security_invoker = true) as
select c.id, c.post_id, c.body, c.created_at, c.author_id,
       p.username::text as author_username, p.display_name as author_display_name, p.avatar_path as author_avatar_path
  from public.post_comments c
  join public.profiles p on p.id = c.author_id
 where c.status = 'published';
grant select on public.post_comment_cards to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════ writes
create function public.create_post_comment(p_post uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_verified_user();
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
begin
  if char_length(v_body) < 1 then
    raise exception 'Write a comment first.' using errcode = '23514';
  end if;
  if char_length(v_body) > 800 then
    raise exception 'Comments can be up to 800 characters.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.posts where id = p_post and status = 'published') then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;

  if (select count(*) from public.post_comments where author_id = v_uid and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Slow down a little. Try again in a few minutes.' using errcode = '54000';
  end if;
  if (select count(*) from public.post_comments where author_id = v_uid and created_at > now() - interval '1 day') >= 100 then
    raise exception 'You have reached today''s comment limit. Try again tomorrow.' using errcode = '54000';
  end if;
  if exists (select 1 from public.post_comments
              where author_id = v_uid and post_id = p_post and body = v_body and status = 'published'
                and created_at > now() - interval '1 day') then
    raise exception 'You already said that.' using errcode = '23505';
  end if;

  insert into public.post_comments (post_id, author_id, body) values (p_post, v_uid, v_body) returning id into v_id;
  return v_id;
end $$;

-- The commenter, the author of the post, or a moderator (with a reason, logged) can remove a comment.
create function public.delete_post_comment(p_comment uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  v_c    record;
  v_own  boolean;
begin
  select c.id, c.author_id, c.status, p.author_id as post_author
    into v_c
    from public.post_comments c join public.posts p on p.id = c.post_id
   where c.id = p_comment for update of c;
  if v_c.id is null or v_c.status = 'removed' then
    raise exception 'Comment not found.' using errcode = 'P0002';
  end if;

  v_own := v_uid = v_c.author_id or v_uid = v_c.post_author;
  if not v_own then
    if not public.is_moderator() then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then
      raise exception 'A reason is required.' using errcode = '23514';
    end if;
  end if;

  update public.post_comments
     set status = 'removed', removed_by = v_uid, removed_at = now(),
         removed_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
   where id = p_comment;

  if not v_own then
    insert into public.moderation_log (actor_id, action, target_type, target_id, reason)
    values (v_uid, 'remove_post_comment', 'post_comment', p_comment, btrim(p_reason));
  end if;
end $$;

revoke execute on function public.create_post_comment(uuid, text), public.delete_post_comment(uuid, text),
                           public.bump_post_comments()
  from public, anon, authenticated;
grant execute on function public.create_post_comment(uuid, text), public.delete_post_comment(uuid, text) to authenticated;

-- Closing your account also hides your posts and comments.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  update public.profiles
     set deleted_at = now(), bio = null, website = null, github = null, x_handle = null,
         linkedin = null, dribbble = null, behance = null, instagram = null, youtube = null,
         location = null, skills = '{}', available_for_hire = false, avatar_path = null, banner_path = null
   where id = v_uid;
  update public.templates set status = 'unlisted'
   where owner_id = v_uid and status = 'published';
  update public.posts set status = 'removed', removed_by = v_uid, removed_at = now()
   where author_id = v_uid and status = 'published';
  update public.post_comments set status = 'removed', removed_by = v_uid, removed_at = now()
   where author_id = v_uid and status = 'published';
  delete from public.follows where follower_id = v_uid or followee_id = v_uid;
  insert into public.moderation_log (actor_id, action, target_type, target_id)
  values (v_uid, 'delete_account', 'profile', v_uid);
end $$;
