-- 1. Every account can own at most 7 templates.
-- 2. Creators (developers/designers) are searchable.

-- ═══════════════════════════════════════════════════════════════ template limit
-- Counts every template the user owns (drafts, published, unlisted, removed).
-- New versions of an existing template don't count; deleting a draft frees a
-- slot. Admins are exempt. Enforced here because create_template is the only
-- way to create a template (clients have no INSERT grant on templates).
create function public.template_limit() returns int
language sql immutable set search_path = '' as $$ select 7 $$;

create or replace function public.create_template(p_title text, p_category_id smallint)
returns table (template_id uuid, slug text, version_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_verified_user();
  v_slug text := public.slugify(p_title);
  v_tpl  uuid;
  v_ver  uuid;
begin
  -- Serialise this user's template creation so two tabs can't both take the last slot.
  perform 1 from public.profiles p where p.id = v_uid for update;
  if not public.is_admin()
     and (select count(*) from public.templates t where t.owner_id = v_uid) >= public.template_limit() then
    raise exception 'You can have up to % templates. Delete a draft to free a slot.', public.template_limit()
      using errcode = '54000';
  end if;
  if (select count(*) from public.templates t
       where t.owner_id = v_uid and t.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You can start up to 10 templates a day' using errcode = '54000';
  end if;
  if exists (select 1 from public.templates t where t.slug = v_slug::extensions.citext) then
    v_slug := left(v_slug, 83) || '-' || substr(md5(random()::text), 1, 6);
  end if;

  insert into public.templates (owner_id, slug, title, category_id)
  values (v_uid, v_slug, btrim(p_title), p_category_id)
  returning id into v_tpl;

  insert into public.template_versions (template_id, owner_id, version)
  values (v_tpl, v_uid, '1.0.0')
  returning id into v_ver;

  return query select v_tpl, v_slug, v_ver;
end $$;

-- For the upload page: "3 of 7 templates used".
create function public.my_template_slots()
returns table (used int, max int, unlimited boolean)
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.templates t where t.owner_id = (select auth.uid()))::int,
         public.template_limit(),
         public.is_admin();
$$;

-- ═══════════════════════════════════════════════════════════════ creator search
-- Matches username, display name or a skill. % and _ in the query are
-- literal (escaped), so a search can't turn into a wildcard scan.
-- SECURITY INVOKER: the caller's RLS applies (deleted profiles stay hidden).
create function public.search_creators(p_q text, p_limit int default 8)
returns setof public.creator_stats
language sql stable security invoker set search_path = '' as $$
  with q as (
    select replace(replace(replace(btrim(ltrim(btrim(coalesce(p_q, '')), '@')), '\', '\\'), '%', '\%'), '_', '\_') as pat,
           lower(btrim(ltrim(btrim(coalesce(p_q, '')), '@'))) as raw
  )
  select c.*
    from public.creator_stats c, q
   where char_length(q.raw) between 2 and 60
     and (c.username ilike '%' || q.pat || '%'
          or c.display_name ilike '%' || q.pat || '%'
          or exists (select 1 from unnest(c.skills) s where s ilike '%' || q.pat || '%'))
   order by lower(c.username) = q.raw desc,
            (c.username ilike q.pat || '%' or c.display_name ilike q.pat || '%') desc,
            c.followers desc, c.template_count desc, c.username
   limit least(greatest(coalesce(p_limit, 8), 1), 24);
$$;

-- Trigram indexes keep "contains" searches fast as the user base grows.
create index profiles_username_trgm_idx     on public.profiles using gin ((username::text) extensions.gin_trgm_ops);
create index profiles_display_name_trgm_idx on public.profiles using gin (display_name extensions.gin_trgm_ops);

revoke execute on function public.template_limit(), public.my_template_slots(), public.search_creators(text, int)
  from public, anon, authenticated;
grant execute on function public.template_limit(), public.search_creators(text, int) to anon, authenticated;
grant execute on function public.my_template_slots() to authenticated;
