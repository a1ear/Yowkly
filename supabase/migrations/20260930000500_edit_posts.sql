-- Authors can edit their own posts. Same rules as creating one (verified email,
-- 1 to 1,500 characters, up to 5 clean tags); the post is marked "Edited" so
-- readers know it changed after likes and comments came in.

alter table public.posts add column edited_at timestamptz;

create function public.update_post(p_post uuid, p_body text, p_tags text[] default '{}')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_verified_user();
  v_body text := btrim(coalesce(p_body, ''));
  v_tags text[] := '{}';
  v_tag  text;
  v_p    record;
begin
  select id, author_id, status into v_p from public.posts where id = p_post for update;
  if v_p.id is null or v_p.status <> 'published' or v_p.author_id is distinct from v_uid then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
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

  update public.posts set body = v_body, tags = v_tags, edited_at = now() where id = p_post;
end $$;

-- Same view as before, with edited_at appended (create or replace can only add columns at the end).
create or replace view public.post_cards with (security_invoker = true) as
select po.id, po.body, po.tags, po.like_count, po.created_at, po.author_id,
       p.username::text as author_username, p.display_name as author_display_name, p.avatar_path as author_avatar_path,
       po.comment_count, po.dislike_count, po.edited_at
  from public.posts po
  join public.profiles p on p.id = po.author_id
 where po.status = 'published';

revoke execute on function public.update_post(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.update_post(uuid, text, text[]) to authenticated;
