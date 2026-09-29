-- Like AND dislike on posts. Still one reaction per person per post: the same
-- post_likes row now carries a kind, and switching from like to dislike changes
-- that row. Who reacted stays private; the public sees the two counts.

alter table public.post_likes add column kind text not null default 'like' check (kind in ('like', 'dislike'));
alter table public.posts add column dislike_count integer not null default 0 check (dislike_count >= 0);

create or replace function public.bump_post_likes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.posts set
      like_count    = greatest(like_count    - (old.kind = 'like')::int, 0),
      dislike_count = greatest(dislike_count - (old.kind = 'dislike')::int, 0)
    where id = old.post_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.posts set
      like_count    = like_count    + (new.kind = 'like')::int,
      dislike_count = dislike_count + (new.kind = 'dislike')::int
    where id = new.post_id;
  end if;
  return null;
end $$;
drop trigger post_likes_count on public.post_likes;
create trigger post_likes_count after insert or update of kind or delete on public.post_likes
  for each row execute function public.bump_post_likes();

-- Clients may pick the kind on the way in and switch it later, only on their own row.
revoke insert on public.post_likes from authenticated;
grant insert (post_id, kind), update (kind) on public.post_likes to authenticated;
create policy "post likes: switch own" on public.post_likes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Same view as before, with dislike_count appended (create or replace can only add columns at the end).
create or replace view public.post_cards with (security_invoker = true) as
select po.id, po.body, po.tags, po.like_count, po.created_at, po.author_id,
       p.username::text as author_username, p.display_name as author_display_name, p.avatar_path as author_avatar_path,
       po.comment_count, po.dislike_count
  from public.posts po
  join public.profiles p on p.id = po.author_id
 where po.status = 'published';
