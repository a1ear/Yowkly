-- Images on community posts: up to 4 per post, PNG/JPG/WebP/GIF, 5 MB each
-- (the browser shrinks and re-encodes them first). Bytes go to the public R2
-- media bucket through a pre-signed PUT for a path this database picks, so a
-- client can't choose where an image lands or attach someone else's.
--
-- Flow: prepare_post_image() reserves a path (a pending row) -> the browser
-- uploads to it -> create_post(..., p_images) attaches the caller's own pending
-- images to the new post. A post may be images only (no text).

create table public.post_images (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  post_id    uuid references public.posts (id) on delete cascade,
  path       text not null unique,
  alt_text   text check (char_length(alt_text) <= 250),
  width      integer check (width between 1 and 10000),
  height     integer check (height between 1 and 10000),
  sort       smallint not null default 0,
  created_at timestamptz not null default now()
);
create index post_images_post_idx on public.post_images (post_id, sort) where post_id is not null;
create index post_images_pending_idx on public.post_images (owner_id, created_at) where post_id is null;

alter table public.post_images enable row level security;
revoke all on public.post_images from anon, authenticated;
grant select on public.post_images to anon, authenticated;
create policy "post images: follow the post, or your own pending" on public.post_images for select
  using (
    (post_id is null and owner_id = (select auth.uid()))
    or exists (select 1 from public.posts p where p.id = post_id
                and (p.status = 'published' or p.author_id = (select auth.uid()) or (select public.is_moderator())))
  );

-- Text becomes optional when a post has images.
alter table public.posts drop constraint posts_body_check;
alter table public.posts add constraint posts_body_check check (char_length(body) <= 1500);

create function public.prepare_post_image(p_content_type text, p_size bigint)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_verified_user();
  v_ext  text := case p_content_type
                   when 'image/png' then 'png' when 'image/jpeg' then 'jpg'
                   when 'image/webp' then 'webp' when 'image/gif' then 'gif' end;
  v_path text;
begin
  if v_ext is null then
    raise exception 'Use a PNG, JPG, WebP or GIF image' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 5242880 then
    raise exception 'Images can be up to 5 MB' using errcode = '22023';
  end if;
  if (select count(*) from public.post_images where owner_id = v_uid and created_at > now() - interval '1 day') >= 60 then
    raise exception 'You have reached today''s image limit. Try again tomorrow.' using errcode = '54000';
  end if;
  v_path := v_uid::text || '/posts/' || gen_random_uuid()::text || '.' || v_ext;
  insert into public.post_images (owner_id, path) values (v_uid, v_path);
  return v_path;
end $$;

drop function public.create_post(text, text[]);
create function public.create_post(p_body text, p_tags text[] default '{}', p_images jsonb default '[]')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_verified_user();
  v_body   text := btrim(coalesce(p_body, ''));
  v_tags   text[] := '{}';
  v_tag    text;
  v_id     uuid;
  v_images jsonb := coalesce(p_images, '[]');
  v_img    jsonb;
  v_i      int := 0;
begin
  if jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) > 4 then
    raise exception 'A post can have up to 4 images.' using errcode = '23514';
  end if;
  if char_length(v_body) < 1 and jsonb_array_length(v_images) = 0 then
    raise exception 'Write something or add an image first.' using errcode = '23514';
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
  if char_length(v_body) > 0 and exists (select 1 from public.posts
              where author_id = v_uid and body = v_body and status = 'published' and created_at > now() - interval '1 day') then
    raise exception 'You already posted that.' using errcode = '23505';
  end if;

  insert into public.posts (author_id, body, tags) values (v_uid, v_body, v_tags) returning id into v_id;

  for v_img in select * from jsonb_array_elements(v_images) loop
    update public.post_images
       set post_id = v_id, sort = v_i,
           alt_text = nullif(left(btrim(coalesce(v_img ->> 'alt', '')), 250), ''),
           width  = case when (v_img ->> 'width')  ~ '^\d{1,5}$' and (v_img ->> 'width')::int  between 1 and 10000 then (v_img ->> 'width')::int end,
           height = case when (v_img ->> 'height') ~ '^\d{1,5}$' and (v_img ->> 'height')::int between 1 and 10000 then (v_img ->> 'height')::int end
     where path = v_img ->> 'path' and owner_id = v_uid and post_id is null;
    if not found then
      raise exception 'That image isn''t yours or was already used. Upload it again.' using errcode = '42501';
    end if;
    v_i := v_i + 1;
  end loop;
  return v_id;
end $$;

-- Editing text must keep a post non-empty when it has no images.
create or replace function public.update_post(p_post uuid, p_body text, p_tags text[] default '{}')
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
  if char_length(v_body) < 1 and not exists (select 1 from public.post_images where post_id = p_post) then
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

-- Same view as before, with the images appended (create or replace can only add columns at the end).
create or replace view public.post_cards with (security_invoker = true) as
select po.id, po.body, po.tags, po.like_count, po.created_at, po.author_id,
       p.username::text as author_username, p.display_name as author_display_name, p.avatar_path as author_avatar_path,
       po.comment_count, po.dislike_count, po.edited_at,
       coalesce((select jsonb_agg(jsonb_build_object('path', i.path, 'alt', i.alt_text, 'width', i.width, 'height', i.height) order by i.sort)
                   from public.post_images i where i.post_id = po.id), '[]') as images
  from public.posts po
  join public.profiles p on p.id = po.author_id
 where po.status = 'published';

revoke execute on function public.prepare_post_image(text, bigint), public.create_post(text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.prepare_post_image(text, bigint), public.create_post(text, text[], jsonb) to authenticated;
