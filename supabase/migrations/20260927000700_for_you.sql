-- For You v1: rule-based and explainable (PLAN.md §8).
--   score = 0.35·affinity + 0.25·follows + 0.25·trending + 0.15·freshness
-- Candidates are capped (top 400 trending + recent work from followed creators)
-- so cost does not grow with the catalogue. SECURITY INVOKER: the caller's RLS
-- scopes every read, so it only ever sees its own likes, votes and downloads.

create function public.for_you(p_limit int default 24, p_offset int default 0)
returns table (template_id uuid, reason text, score double precision)
language sql stable security invoker set search_path = '' as $$
with me as (select auth.uid() as uid),
signals as (
  select tt.tag_id, 1.0 as w from public.likes l
    join public.template_tags tt on tt.template_id = l.template_id where l.user_id = (select uid from me)
  union all
  select tt.tag_id, 2.0 from public.votes v
    join public.template_tags tt on tt.template_id = v.template_id where v.user_id = (select uid from me)
  union all
  select tt.tag_id, 3.0 from public.downloads d
    join public.template_tags tt on tt.template_id = d.template_id where d.user_id = (select uid from me)
  union all
  select i.tag_id, 2.0 from public.user_interest_tags i where i.user_id = (select uid from me)
),
tag_aff as (select tag_id, sum(w) as w from signals group by tag_id),
cat_aff as (
  select c.id as category_id, 2.0 as w from public.user_interest_categories i
    join public.categories c on c.id = i.category_id or c.parent_id = i.category_id
   where i.user_id = (select uid from me)
),
followed as (select followee_id from public.follows where follower_id = (select uid from me)),
seen as (
  select template_id from public.likes where user_id = (select uid from me)
  union select template_id from public.downloads where user_id = (select uid from me)
),
candidates as (
  (select t.id from public.templates t join public.template_stats s on s.template_id = t.id
    where t.status = 'published' order by s.hot_score desc, t.published_at desc limit 400)
  union
  (select t.id from public.templates t
    where t.status = 'published' and t.owner_id in (select followee_id from followed)
      and t.published_at > now() - interval '60 days')
),
scored as (
  select t.id, t.owner_id, t.published_at, s.hot_score,
         coalesce((select sum(a.w) from public.template_tags tt join tag_aff a on a.tag_id = tt.tag_id
                    where tt.template_id = t.id), 0)
       + coalesce((select max(ca.w) from cat_aff ca where ca.category_id = t.category_id), 0) as affinity,
         (t.owner_id in (select followee_id from followed))::int as is_followed,
         exp(-0.231 * extract(epoch from (now() - t.published_at)) / 86400.0) as freshness
    from candidates c
    join public.templates t on t.id = c.id
    join public.template_stats s on s.template_id = t.id
   where t.owner_id <> coalesce((select uid from me), '00000000-0000-0000-0000-000000000000'::uuid)
     and t.id not in (select template_id from seen)
),
normalised as (
  select *,
         0.35 * coalesce(affinity / nullif(max(affinity) over (), 0), 0)
       + 0.25 * is_followed
       + 0.25 * coalesce(hot_score / nullif(max(hot_score) over (), 0), 0)
       + 0.15 * freshness as total
    from scored
),
diverse as (
  select *, row_number() over (partition by owner_id order by total desc) as per_owner
    from normalised
)
select d.id,
       case
         when d.is_followed = 1 then 'Because you follow ' || p.display_name
         when d.affinity > 0 then coalesce(
           (select 'Popular in ' || g.name from public.template_tags tt
              join tag_aff a on a.tag_id = tt.tag_id join public.tags g on g.id = tt.tag_id
             where tt.template_id = d.id order by a.w desc limit 1),
           'Matches your interests')
         else 'Trending on Yowkly'
       end,
       d.total
  from diverse d
  join public.profiles p on p.id = d.owner_id
 where d.per_owner <= 2
 order by d.total desc, d.published_at desc
 limit least(greatest(p_limit, 1), 48) offset greatest(p_offset, 0);
$$;

grant execute on function public.for_you(int, int) to authenticated;
