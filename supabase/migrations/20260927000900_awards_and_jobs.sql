-- Awards and scheduled jobs.
-- Ranking uses a Bayesian average so a handful of perfect votes cannot beat
-- hundreds of strong ones:  (C·m + Σscore·w) / (C + Σw),  m = site-wide mean, C = 10.

create function public.grant_award(p_period public.award_period, p_start date, p_category_slug text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_mean     numeric;
  v_cat      smallint;
  v_window   interval := case p_period when 'day' then interval '7 days' when 'week' then interval '30 days' else interval '90 days' end;
  v_min      int := case p_period when 'day' then 10 when 'week' then 20 else 30 end;
  v_pick     record;
  v_id       uuid;
begin
  if p_category_slug is not null then
    select id into v_cat from public.categories where slug = p_category_slug;
    if v_cat is null then raise exception 'Unknown category %', p_category_slug; end if;
  end if;
  select coalesce(sum(score_sum) / nullif(sum(weight_sum), 0), 7) into v_mean from public.template_stats;

  select t.id, t.owner_id, s.vote_count,
         (10 * v_mean + s.score_sum) / (10 + s.weight_sum) as bayes
    into v_pick
    from public.templates t
    join public.template_stats s on s.template_id = t.id
    left join public.categories c on c.id = t.category_id
   where t.status = 'published'
     and t.published_at > (p_start + 1)::timestamptz - v_window
     and t.published_at < (p_start + 1)::timestamptz
     and s.vote_count >= v_min
     and (v_cat is null or c.id = v_cat or c.parent_id = v_cat)
     and not exists (select 1 from public.awards a
                      where a.template_id = t.id and a.period = p_period and a.category_id is not distinct from v_cat)
   order by bayes desc, s.vote_count desc, t.published_at
   limit 1;

  if v_pick.id is null then return null; end if;

  insert into public.awards (template_id, period, period_start, category_id, score_snapshot, vote_count_snapshot)
  values (v_pick.id, p_period, p_start, v_cat, round(v_pick.bayes, 3), v_pick.vote_count)
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    perform public.notify(v_pick.owner_id, 'award', null, v_pick.id, null,
                          jsonb_build_object('period', p_period, 'period_start', p_start, 'category', p_category_slug));
  end if;
  return v_id;
end $$;

grant execute on function public.grant_award(public.award_period, date, text) to service_role;

-- Soft-deleted accounts are purged 30 days later (profile row cascades from auth.users).
create function public.purge_deleted_accounts() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  with gone as (
    delete from auth.users u using public.profiles p
     where p.id = u.id and p.deleted_at < now() - interval '30 days'
    returning u.id
  )
  select count(*) into v_n from gone;
  return v_n;
end $$;

grant execute on function public.purge_deleted_accounts() to service_role;

-- Schedules (UTC). pg_cron exists on Supabase; the guard keeps other Postgres builds working.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('refresh-hot-scores', '*/15 * * * *', 'select public.refresh_hot_scores()');
    perform cron.schedule('award-day',   '0 0 * * *',  $j$select public.grant_award('day', current_date - 1)$j$);
    perform cron.schedule('award-week',  '5 0 * * 1',  $j$select public.grant_award('week', current_date - 7); select public.grant_award('week', current_date - 7, 'mobile-apps')$j$);
    perform cron.schedule('award-month', '10 0 1 * *', $j$select public.grant_award('month', (date_trunc('month', current_date) - interval '1 month')::date)$j$);
    perform cron.schedule('purge-deleted-accounts', '0 3 * * *', 'select public.purge_deleted_accounts()');
  end if;
end $$;
