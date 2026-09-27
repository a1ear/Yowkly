-- Daily series for the creator dashboard. Raw downloads and votes are private to
-- the person who made them, so creators get aggregates over their OWN templates
-- only, never individual rows or voter identities.

create function public.creator_analytics(p_days int default 30, p_template uuid default null)
returns table (day date, views int, downloads int, likes int, votes int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  v_days int := least(greatest(coalesce(p_days, 30), 7), 365);
begin
  return query
  with mine as (
    select t.id from public.templates t
     where t.owner_id = v_uid and (p_template is null or t.id = p_template)
  ),
  days as (select generate_series(current_date - (v_days - 1), current_date, interval '1 day')::date as d)
  select days.d,
    coalesce((select sum(v.views) from public.template_view_daily v where v.day = days.d and v.template_id in (select id from mine)), 0)::int,
    (select count(*) from public.downloads x where x.created_at::date = days.d and x.template_id in (select id from mine))::int,
    (select count(*) from public.likes l where l.created_at::date = days.d and l.template_id in (select id from mine))::int,
    (select count(*) from public.votes o where o.created_at::date = days.d and o.template_id in (select id from mine))::int
  from days order by days.d;
end $$;

grant execute on function public.creator_analytics(int, uuid) to authenticated;
