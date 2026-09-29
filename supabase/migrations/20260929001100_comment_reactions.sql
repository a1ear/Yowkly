-- Like / dislike on post comments, and a "preview" read that returns the best
-- couple of comments for a page of posts in one query.
--
-- Same model as post reactions: one reaction per person per comment, stored as a
-- private row, with public counts on the comment. Switching changes the row.

create table public.post_comment_likes (
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null default 'like' check (kind in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.post_comment_likes alter column user_id set default auth.uid();
create index post_comment_likes_user_idx on public.post_comment_likes (user_id, created_at desc);

alter table public.post_comments add column like_count integer not null default 0 check (like_count >= 0);
alter table public.post_comments add column dislike_count integer not null default 0 check (dislike_count >= 0);

create function public.bump_comment_likes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.post_comments set
      like_count    = greatest(like_count    - (old.kind = 'like')::int, 0),
      dislike_count = greatest(dislike_count - (old.kind = 'dislike')::int, 0)
    where id = old.comment_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.post_comments set
      like_count    = like_count    + (new.kind = 'like')::int,
      dislike_count = dislike_count + (new.kind = 'dislike')::int
    where id = new.comment_id;
  end if;
  return null;
end $$;
create trigger post_comment_likes_count after insert or update of kind or delete on public.post_comment_likes
  for each row execute function public.bump_comment_likes();

-- ═══════════════════════════════════════════════════════════════ access
revoke all on public.post_comment_likes from anon, authenticated;
alter table public.post_comment_likes enable row level security;

-- Who reacted stays private; the public sees the counts on the comment.
grant select on public.post_comment_likes to authenticated;
create policy "comment reactions: read own" on public.post_comment_likes for select to authenticated
  using (user_id = (select auth.uid()));
grant insert (comment_id, kind), update (kind), delete on public.post_comment_likes to authenticated;
create policy "comment reactions: react to a published comment as yourself" on public.post_comment_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.post_comments c where c.id = comment_id and c.status = 'published')
  );
create policy "comment reactions: switch own" on public.post_comment_likes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "comment reactions: remove own" on public.post_comment_likes for delete to authenticated
  using (user_id = (select auth.uid()));

-- ═══════════════════════════════════════════════════════════════ reads
-- Same view as before, with the counts appended (create or replace can only add columns at the end).
create or replace view public.post_comment_cards with (security_invoker = true) as
select c.id, c.post_id, c.body, c.created_at, c.author_id,
       p.username::text as author_username, p.display_name as author_display_name, p.avatar_path as author_avatar_path,
       c.like_count, c.dislike_count
  from public.post_comments c
  join public.profiles p on p.id = c.author_id
 where c.status = 'published';

-- The best comments for each of up to 50 posts: most liked first, newest breaks ties.
create function public.post_comment_previews(p_post_ids uuid[], p_per_post int default 2)
returns table (
  id uuid, post_id uuid, body text, created_at timestamptz, author_id uuid,
  author_username text, author_display_name text, author_avatar_path text,
  like_count integer, dislike_count integer
)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.post_id, r.body, r.created_at, r.author_id,
         r.author_username, r.author_display_name, r.author_avatar_path, r.like_count, r.dislike_count
    from (
      select c.*, row_number() over (partition by c.post_id
                                     order by (c.like_count - c.dislike_count) desc, c.created_at desc) as rn
        from public.post_comment_cards c
       where c.post_id = any (p_post_ids[1:50])
    ) r
   where r.rn <= least(greatest(coalesce(p_per_post, 2), 1), 3)
   order by r.post_id, r.rn;
$$;

revoke execute on function public.bump_comment_likes() from public, anon, authenticated;
grant execute on function public.post_comment_previews(uuid[], int) to anon, authenticated;
