-- Read models for listing pages. security_invoker = true means the caller's RLS
-- applies to every underlying table, so a view can never widen access.

create view public.template_cards with (security_invoker = true) as
select
  t.id, t.slug::text as slug, t.title, t.tagline, t.cover_path, t.status, t.published_at, t.created_at,
  t.owner_id, p.username::text as owner_username, p.display_name as owner_display_name, p.avatar_path as owner_avatar_path,
  c.id as category_id, c.slug as category_slug, c.name as category_name, c.kind as category_kind,
  pc.slug as parent_category_slug,
  s.like_count, s.download_count, s.save_count, s.comment_count, s.view_count, s.vote_count,
  case when s.weight_sum > 0 then round(s.score_sum / s.weight_sum, 1) end as score,
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
  t.search_tsv
from public.templates t
join public.profiles p on p.id = t.owner_id
left join public.categories c on c.id = t.category_id
left join public.categories pc on pc.id = c.parent_id
left join public.template_stats s on s.template_id = t.id
left join public.template_versions v on v.id = t.current_version_id
left join public.licenses l on l.code = v.license_code;

grant select on public.template_cards to anon, authenticated;

-- Creator summary for profile headers and "Rising creators".
create view public.creator_stats with (security_invoker = true) as
select
  p.id, p.username::text as username, p.display_name, p.avatar_path, p.bio, p.location, p.skills,
  p.available_for_hire, p.website, p.github, p.x_handle, p.created_at, p.hide_likes,
  (select count(*) from public.templates t where t.owner_id = p.id and t.status = 'published')::int as template_count,
  (select coalesce(sum(s.download_count), 0) from public.templates t join public.template_stats s on s.template_id = t.id
    where t.owner_id = p.id and t.status = 'published')::int as downloads,
  (select coalesce(sum(s.like_count), 0) from public.templates t join public.template_stats s on s.template_id = t.id
    where t.owner_id = p.id and t.status = 'published')::int as likes_received,
  (select count(*) from public.awards a join public.templates t on t.id = a.template_id where t.owner_id = p.id)::int as awards,
  (select count(*) from public.follows f where f.followee_id = p.id)::int as followers,
  (select count(*) from public.follows f where f.follower_id = p.id)::int as following
from public.profiles p
where p.deleted_at is null;

grant select on public.creator_stats to anon, authenticated;
