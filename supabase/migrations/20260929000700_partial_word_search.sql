-- Search that matches part of a word ("my" finds "My portfolio", "port" finds "portfolio").
-- The old full-text search dropped stop words like "my" and only matched whole words.
-- search_text is a lower-cased copy of what people type into the search box; the
-- trigram index keeps "contains" searches fast as the catalogue grows.
alter table public.templates add column search_text text generated always as (
  lower(title || ' ' || coalesce(tagline, '') || ' ' || coalesce(description, ''))
) stored;

create index templates_search_text_trgm_idx on public.templates using gin (search_text extensions.gin_trgm_ops);

-- Same view as before, with search_text appended (create or replace can only add columns at the end).
create or replace view public.template_cards with (security_invoker = true) as
select
  t.id, t.slug::text as slug, t.title, t.tagline, t.cover_path, t.status, t.published_at, t.created_at,
  t.owner_id, p.username::text as owner_username, p.display_name as owner_display_name, p.avatar_path as owner_avatar_path,
  c.id as category_id, c.slug as category_slug, c.name as category_name, c.kind as category_kind,
  pc.slug as parent_category_slug,
  s.like_count, s.download_count, s.save_count, s.comment_count, s.view_count, s.vote_count,
  s.hot_score,
  v.version, v.license_code, l.allows_commercial,
  coalesce((select array_agg(g.slug order by g.type, g.name) from public.template_tags tt
             join public.tags g on g.id = tt.tag_id where tt.template_id = t.id), '{}') as tag_slugs,
  coalesce((select jsonb_agg(jsonb_build_object('slug', g.slug, 'name', g.name, 'type', g.type) order by g.type, g.name)
              from public.template_tags tt join public.tags g on g.id = tt.tag_id where tt.template_id = t.id), '[]') as tags,
  array(select distinct x from (
      select f.source_tool::text as x from public.template_files f
       where f.version_id = t.current_version_id and f.scan_status = 'clean'
      union
      select k.kind::text from public.template_links k where k.template_id = t.id
    ) tools order by x) as tools,
  (select jsonb_build_object('period', a.period, 'period_start', a.period_start, 'category', ac.name)
     from public.awards a left join public.categories ac on ac.id = a.category_id
    where a.template_id = t.id order by a.period_start desc, a.period limit 1) as award,
  t.search_tsv,
  t.search_text
from public.templates t
join public.profiles p on p.id = t.owner_id
left join public.categories c on c.id = t.category_id
left join public.categories pc on pc.id = c.parent_id
left join public.template_stats s on s.template_id = t.id
left join public.template_versions v on v.id = t.current_version_id
left join public.licenses l on l.code = v.license_code;;
