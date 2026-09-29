-- Community posts: short text posts with tags, shown on the creator's profile
-- (Posts tab) and in the Community feed. Plain text only (no links are
-- rendered, no HTML), likes are private rows with a public count.
--
-- Access model:
--   * Everyone can read published posts. Nobody writes to the tables directly:
--     posts are created and removed through create_post / delete_post, which
--     re-check the caller, validate the input and apply the limits.
--   * A post you delete (or a moderator removes) is hidden, not erased, so a
--     report about it can still be judged. It stays out of every public read.

alter type public.report_target add value if not exists 'post';

create table public.posts (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references public.profiles (id) on delete cascade,
  body           text not null check (char_length(btrim(body)) between 1 and 1500),
  tags           text[] not null default '{}' check (cardinality(tags) <= 5),
  status         text not null default 'published' check (status in ('published', 'removed')),
  like_count     integer not null default 0 check (like_count >= 0),
  removed_by     uuid references public.profiles (id) on delete set null,
  removed_reason text check (char_length(removed_reason) <= 500),
  removed_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index posts_feed_idx   on public.posts (created_at desc) where status = 'published';
create index posts_author_idx on public.posts (author_id, created_at desc) where status = 'published';
create index posts_tags_idx   on public.posts using gin (tags);

create table public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_likes alter column user_id set default auth.uid();
create index post_likes_user_idx on public.post_likes (user_id, created_at desc);

-- The counter lives on the post so the feed reads one table.
create function public.bump_post_likes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  else
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;
create trigger post_likes_count after insert or delete on public.post_likes
  for each row execute function public.bump_post_likes();

-- ═══════════════════════════════════════════════════════════════ access
revoke all on public.posts, public.post_likes from anon, authenticated;
alter table public.posts      enable row level security;
alter table public.post_likes enable row level security;

grant select on public.posts to anon, authenticated;
create policy "posts: published, or yours, or moderator" on public.posts for select
  using (status = 'published' or author_id = (select auth.uid()) or (select public.is_moderator()));

-- Who liked what stays private; the public sees the count on the post.
grant select on public.post_likes to authenticated;
create policy "post likes: read own" on public.post_likes for select to authenticated
  using (user_id = (select auth.uid()));
grant insert (post_id), delete on public.post_likes to authenticated;
create policy "post likes: like a published post as yourself" on public.post_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published')
  );
create policy "post likes: unlike own" on public.post_likes for delete to authenticated
  using (user_id = (select auth.uid()));

-- ═══════════════════════════════════════════════════════════════ reads
create view public.post_cards with (security_invoker = true) as
select po.id, po.body, po.tags, po.like_count, po.created_at, po.author_id,
       p.username::text as author_username, p.display_name as author_display_name, p.avatar_path as author_avatar_path
  from public.posts po
  join public.profiles p on p.id = po.author_id
 where po.status = 'published';
grant select on public.post_cards to anon, authenticated;

-- Tags people used most in the last 30 days, for the Community filter.
create function public.popular_post_tags(p_limit int default 12)
returns table (tag text, uses bigint)
language sql stable security invoker set search_path = '' as $$
  select t.tag, count(*) as uses
    from public.posts po, unnest(po.tags) as t(tag)
   where po.status = 'published' and po.created_at > now() - interval '30 days'
   group by t.tag
   order by uses desc, t.tag
   limit least(greatest(coalesce(p_limit, 12), 1), 30);
$$;

-- ═══════════════════════════════════════════════════════════════ writes
create function public.create_post(p_body text, p_tags text[] default '{}')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_verified_user();
  v_body text := btrim(coalesce(p_body, ''));
  v_tags text[] := '{}';
  v_tag  text;
  v_id   uuid;
begin
  if char_length(v_body) < 1 then
    raise exception 'Write something first.' using errcode = '23514';
  end if;
  if char_length(v_body) > 1500 then
    raise exception 'Posts can be up to 1,500 characters.' using errcode = '23514';
  end if;

  foreach v_tag in array coalesce(p_tags, '{}') loop
    v_tag := regexp_replace(lower(btrim(v_tag)), '^#+', '');
    if v_tag = '' then continue; end if;
    if v_tag !~ '^[a-z0-9][a-z0-9-]{1,23}$' then
      raise exception 'Tags are 2 to 24 letters, numbers or dashes.' using errcode = '23514';
    end if;
    if not (v_tag = any (v_tags)) then v_tags := v_tags || v_tag; end if;
  end loop;
  if cardinality(v_tags) > 5 then
    raise exception 'Use up to 5 tags.' using errcode = '23514';
  end if;

  if (select count(*) from public.posts where author_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have reached today''s post limit. Try again tomorrow.' using errcode = '54000';
  end if;
  if exists (select 1 from public.posts
              where author_id = v_uid and body = v_body and status = 'published' and created_at > now() - interval '1 day') then
    raise exception 'You already posted that.' using errcode = '23505';
  end if;

  insert into public.posts (author_id, body, tags) values (v_uid, v_body, v_tags) returning id into v_id;
  return v_id;
end $$;

-- The author removes their own post; a moderator removes anyone's (with a reason, logged).
create function public.delete_post(p_post uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_p   record;
begin
  select id, author_id, status into v_p from public.posts where id = p_post for update;
  if v_p.id is null or v_p.status = 'removed' then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if v_p.author_id is distinct from v_uid then
    if not public.is_moderator() then
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
    insert into public.moderation_log (actor_id, action, target_type, target_id, reason)
    values (v_uid, 'remove_post', 'post', p_post, btrim(p_reason));
  end if;
end $$;

revoke execute on function public.create_post(text, text[]), public.delete_post(uuid, text),
                           public.bump_post_likes()
  from public, anon, authenticated;
grant execute on function public.create_post(text, text[]), public.delete_post(uuid, text) to authenticated;
grant execute on function public.popular_post_tags(int) to anon, authenticated;

-- Closing your account also hides your posts.
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
  delete from public.follows where follower_id = v_uid or followee_id = v_uid;
  insert into public.moderation_log (actor_id, action, target_type, target_id)
  values (v_uid, 'delete_account', 'profile', v_uid);
end $$;
