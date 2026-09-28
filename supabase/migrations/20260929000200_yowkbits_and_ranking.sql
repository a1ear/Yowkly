-- Yowkbits: votes are now a spend, separate from likes.
--
--   Likes  are free, unlimited and undoable. They never touch the Ranking.
--   Votes  cost 1 yowkbit, one per template, and are final. Votes drive the
--          Ranking (Template of the Day/Week/Month) and Dev of the Week.
--
-- Every account starts with 100 yowkbits. Balances live in yowkbit_wallets
-- (CHECK balance >= 0, so overspending is impossible even under concurrency);
-- every change is also written to the append-only yowkbit_ledger, so a balance
-- can always be explained. Clients can read their own wallet and ledger and
-- nothing else; the only way to spend is public.cast_vote().
--
-- The old 1-10 rating votes (design/usability/creativity/code) are dropped.
-- This ships before launch, so there are no production ratings to preserve.

-- ═══════════════════════════════════════════════════════════════ drop the rating model
drop table public.votes;                 -- takes its triggers, policies and index with it
drop function public.before_vote();
drop function public.on_vote_change();

drop view public.template_cards;         -- recreated below without the rating score
alter table public.template_stats
  drop column weight_sum, drop column score_sum, drop column design_sum, drop column usability_sum,
  drop column creativity_sum, drop column code_sum, drop column code_weight_sum;
update public.template_stats set vote_count = 0 where vote_count <> 0;

-- ═══════════════════════════════════════════════════════════════ wallets and ledger
create table public.yowkbit_wallets (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.yowkbit_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  delta       integer not null check (delta <> 0),
  reason      text not null check (reason in ('signup_grant', 'vote', 'adjustment')),
  template_id uuid references public.templates (id) on delete set null,
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now()
);
create index yowkbit_ledger_user_idx on public.yowkbit_ledger (user_id, created_at desc);

-- Append-only. The one permitted change is the FK nulling template_id when a
-- template is deleted; the spend itself stays on record.
create function public.guard_yowkbit_ledger() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.user_id, new.delta, new.reason, new.note, new.created_at)
       is not distinct from (old.id, old.user_id, old.delta, old.reason, old.note, old.created_at)
     and new.template_id is null then
    return new;
  end if;
  raise exception 'The yowkbit ledger is append-only' using errcode = '42501';
end $$;
create trigger yowkbit_ledger_guard before update on public.yowkbit_ledger
  for each row execute function public.guard_yowkbit_ledger();

-- Every new profile gets its starting yowkbits, recorded in the ledger.
create function public.grant_signup_yowkbits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.yowkbit_wallets (user_id, balance) values (new.id, 100);
  insert into public.yowkbit_ledger (user_id, delta, reason) values (new.id, 100, 'signup_grant');
  return null;
end $$;
create trigger profiles_signup_yowkbits after insert on public.profiles
  for each row execute function public.grant_signup_yowkbits();

-- Accounts that existed before yowkbits get the same start.
insert into public.yowkbit_wallets (user_id, balance)
select p.id, 100 from public.profiles p
 where not exists (select 1 from public.yowkbit_wallets w where w.user_id = p.id);
insert into public.yowkbit_ledger (user_id, delta, reason)
select p.id, 100, 'signup_grant' from public.profiles p
 where not exists (select 1 from public.yowkbit_ledger l where l.user_id = p.id and l.reason = 'signup_grant');

-- ═══════════════════════════════════════════════════════════════ votes
create table public.votes (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  template_id uuid not null references public.templates (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, template_id)
);
create index votes_template_idx on public.votes (template_id, created_at);
create index votes_created_idx  on public.votes (created_at);

-- Votes are final: no edits. Rows only disappear when the voter's account or
-- the template is purged (FK cascade), and the counter follows.
create function public.guard_votes() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Votes are final' using errcode = '42501';
end $$;
create trigger votes_guard before update on public.votes
  for each row execute function public.guard_votes();

create function public.on_vote_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.template_stats set vote_count = vote_count + 1, updated_at = now() where template_id = new.template_id;
  else
    update public.template_stats set vote_count = greatest(vote_count - 1, 0), updated_at = now() where template_id = old.template_id;
  end if;
  return null;
end $$;
create trigger votes_stats after insert or delete on public.votes
  for each row execute function public.on_vote_change();

-- Returns 'ok' or the reason the current user may not vote. Used by cast_vote and the UI.
create or replace function public.vote_eligibility(p_template uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_created timestamptz;
  v_owner   uuid;
  v_status  public.template_status;
begin
  if v_uid is null then return 'auth'; end if;
  select owner_id, status into v_owner, v_status from public.templates where id = p_template;
  if v_owner is null or v_status <> 'published' then return 'not_published'; end if;
  if v_owner = v_uid then return 'own'; end if;
  if not public.auth_email_verified() then return 'unverified'; end if;
  -- A short wait stops throwaway accounts from voting the moment they sign up.
  select created_at into v_created from auth.users where id = v_uid;
  if v_created > now() - interval '24 hours' then return 'too_new'; end if;
  if exists (select 1 from public.votes where user_id = v_uid and template_id = p_template) then return 'voted'; end if;
  if coalesce((select balance from public.yowkbit_wallets where user_id = v_uid), 0) < 1 then return 'no_bits'; end if;
  return 'ok';
end $$;

-- The only way to vote: spends exactly 1 yowkbit, atomically.
create function public.cast_vote(p_template uuid)
returns table (balance integer, vote_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := public.require_verified_user();
  v_reason  text;
  v_balance integer;
  v_count   integer;
begin
  -- Lock the wallet first so two votes from the same person run one after the other.
  perform 1 from public.yowkbit_wallets w where w.user_id = v_uid for update;
  v_reason := public.vote_eligibility(p_template);
  if v_reason <> 'ok' then
    case v_reason
      when 'not_published' then raise exception 'Template not found' using errcode = 'P0002';
      when 'own'      then raise exception 'You can''t vote on your own work' using errcode = '42501';
      when 'too_new'  then raise exception 'New accounts can vote 24 hours after signing up' using errcode = '42501';
      when 'voted'    then raise exception 'You already voted for this template' using errcode = '23505';
      when 'no_bits'  then raise exception 'You are out of yowkbits' using errcode = '54000';
      else raise exception 'You cannot vote on this template' using errcode = '42501';
    end case;
  end if;
  if (select count(*) from public.votes v
       where v.user_id = v_uid and v.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many votes. Try again later.' using errcode = '54000';
  end if;

  insert into public.votes (user_id, template_id) values (v_uid, p_template);
  update public.yowkbit_wallets w set balance = w.balance - 1, updated_at = now()
   where w.user_id = v_uid returning w.balance into v_balance;
  insert into public.yowkbit_ledger (user_id, delta, reason, template_id) values (v_uid, -1, 'vote', p_template);
  select s.vote_count into v_count from public.template_stats s where s.template_id = p_template;
  return query select v_balance, v_count;
end $$;

-- ═══════════════════════════════════════════════════════════════ access
revoke all on public.yowkbit_wallets, public.yowkbit_ledger, public.votes from anon, authenticated;
revoke all on sequence public.yowkbit_ledger_id_seq from anon, authenticated;
alter table public.yowkbit_wallets enable row level security;
alter table public.yowkbit_ledger  enable row level security;
alter table public.votes           enable row level security;

grant select on public.yowkbit_wallets, public.yowkbit_ledger to authenticated;
create policy "wallets: read own" on public.yowkbit_wallets for select to authenticated
  using (user_id = (select auth.uid()));
create policy "ledger: read own" on public.yowkbit_ledger for select to authenticated
  using (user_id = (select auth.uid()));

-- Raw votes are private to the voter; everyone else sees counts.
grant select on public.votes to authenticated;
create policy "votes: read own or admin" on public.votes for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ═══════════════════════════════════════════════════════════════ template cards (no rating score)
create view public.template_cards with (security_invoker = true) as
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
  t.search_tsv
from public.templates t
join public.profiles p on p.id = t.owner_id
left join public.categories c on c.id = t.category_id
left join public.categories pc on pc.id = c.parent_id
left join public.template_stats s on s.template_id = t.id
left join public.template_versions v on v.id = t.current_version_id
left join public.licenses l on l.code = v.license_code;

grant select on public.template_cards to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════ ranking: templates
-- Winners are decided by votes received during the period. Old rating-based
-- awards keep their score_snapshot; new ones record period_votes instead.
alter table public.awards alter column score_snapshot drop not null;
alter table public.awards add column period_votes integer check (period_votes >= 0);

create or replace function public.guard_awards() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.template_id, new.period, new.period_start, new.category_id,
      new.score_snapshot, new.vote_count_snapshot, new.period_votes, new.created_at)
     is not distinct from
     (old.id, old.template_id, old.period, old.period_start, old.category_id,
      old.score_snapshot, old.vote_count_snapshot, old.period_votes, old.created_at) then
    return new;
  end if;
  raise exception 'Awards are immutable' using errcode = '42501';
end $$;

-- Periods are UTC calendar days, ISO weeks (Monday) and calendar months.
create function public.ranking_period_end(p_period public.award_period, p_start date) returns date
language sql immutable set search_path = '' as $$
  select case p_period when 'day' then p_start + 1 when 'week' then p_start + 7
                       else (p_start + interval '1 month')::date end;
$$;

create function public.ranking_period_start(p_period public.award_period, p_at timestamptz default now()) returns date
language sql stable set search_path = '' as $$
  select date_trunc(case p_period when 'day' then 'day' when 'week' then 'week' else 'month' end,
                    p_at at time zone 'utc')::date;
$$;

create or replace function public.grant_award(p_period public.award_period, p_start date, p_category_slug text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_cat   smallint;
  v_from  timestamptz := p_start::timestamp at time zone 'utc';
  v_to    timestamptz := public.ranking_period_end(p_period, p_start)::timestamp at time zone 'utc';
  v_min   int := case p_period when 'day' then 3 when 'week' then 5 else 10 end;
  v_pick  record;
  v_id    uuid;
begin
  if p_category_slug is not null then
    select id into v_cat from public.categories where slug = p_category_slug;
    if v_cat is null then raise exception 'Unknown category %', p_category_slug; end if;
  end if;

  -- Most votes received in the period wins; a tie goes to whoever got there first.
  select t.id, t.owner_id, count(*)::int as period_votes, s.vote_count
    into v_pick
    from public.votes vt
    join public.templates t on t.id = vt.template_id
    join public.template_stats s on s.template_id = t.id
    left join public.categories c on c.id = t.category_id
   where vt.created_at >= v_from and vt.created_at < v_to
     and t.status = 'published'
     and (v_cat is null or c.id = v_cat or c.parent_id = v_cat)
     and not exists (select 1 from public.awards a
                      where a.template_id = t.id and a.period = p_period and a.category_id is not distinct from v_cat)
   group by t.id, t.owner_id, s.vote_count
  having count(*) >= v_min
   order by count(*) desc, max(vt.created_at), t.published_at
   limit 1;

  if v_pick.id is null then return null; end if;

  insert into public.awards (template_id, period, period_start, category_id, score_snapshot, vote_count_snapshot, period_votes)
  values (v_pick.id, p_period, p_start, v_cat, null, v_pick.vote_count, v_pick.period_votes)
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    perform public.notify(v_pick.owner_id, 'award', null, v_pick.id, null,
                          jsonb_build_object('period', p_period, 'period_start', p_start, 'category', p_category_slug));
  end if;
  return v_id;
end $$;

-- ═══════════════════════════════════════════════════════════════ ranking: Dev of the Week
-- The creator whose published templates received the most votes that week.
create table public.dev_awards (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  week_start         date not null unique check (extract(isodow from week_start) = 1),
  vote_count         integer not null check (vote_count >= 0),
  template_count     integer not null check (template_count >= 0),
  created_at         timestamptz not null default now()
);
create index dev_awards_user_idx on public.dev_awards (user_id);

create function public.guard_dev_awards() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Awards are immutable' using errcode = '42501';
end $$;
create trigger dev_awards_guard before update on public.dev_awards
  for each row execute function public.guard_dev_awards();

revoke all on public.dev_awards from anon, authenticated;
alter table public.dev_awards enable row level security;
grant select on public.dev_awards to anon, authenticated;
create policy "dev awards: public" on public.dev_awards for select using (true);

create function public.grant_dev_of_week(p_start date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := p_start::timestamp at time zone 'utc';
  v_to   timestamptz := (p_start + 7)::timestamp at time zone 'utc';
  v_pick record;
  v_id   uuid;
begin
  if extract(isodow from p_start) <> 1 then raise exception 'Weeks start on Monday'; end if;
  select t.owner_id, count(*)::int as votes, count(distinct t.id)::int as templates
    into v_pick
    from public.votes vt
    join public.templates t on t.id = vt.template_id
    join public.profiles p on p.id = t.owner_id
   where vt.created_at >= v_from and vt.created_at < v_to
     and t.status = 'published' and p.deleted_at is null
   group by t.owner_id
  having count(*) >= 5
   order by count(*) desc, max(vt.created_at)
   limit 1;

  if v_pick.owner_id is null then return null; end if;

  insert into public.dev_awards (user_id, week_start, vote_count, template_count)
  values (v_pick.owner_id, p_start, v_pick.votes, v_pick.templates)
  on conflict (week_start) do nothing
  returning id into v_id;

  if v_id is not null then
    perform public.notify(v_pick.owner_id, 'award', null, null, null,
                          jsonb_build_object('kind', 'dev_of_week', 'period_start', p_start, 'votes', v_pick.votes));
  end if;
  return v_id;
end $$;

-- ═══════════════════════════════════════════════════════════════ live standings (aggregates only)
create function public.ranking_templates(p_period public.award_period default 'week', p_limit int default 10)
returns table (template_id uuid, votes integer)
language sql stable security definer set search_path = '' as $$
  select vt.template_id, count(*)::int
    from public.votes vt
    join public.templates t on t.id = vt.template_id
   where t.status = 'published'
     and vt.created_at >= public.ranking_period_start(p_period)::timestamp at time zone 'utc'
   group by vt.template_id
   order by count(*) desc, max(vt.created_at)
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

create function public.ranking_devs(p_limit int default 10)
returns table (user_id uuid, votes integer, templates integer)
language sql stable security definer set search_path = '' as $$
  select t.owner_id, count(*)::int, count(distinct t.id)::int
    from public.votes vt
    join public.templates t on t.id = vt.template_id
    join public.profiles p on p.id = t.owner_id
   where t.status = 'published' and p.deleted_at is null
     and vt.created_at >= public.ranking_period_start('week')::timestamp at time zone 'utc'
   group by t.owner_id
   order by count(*) desc, max(vt.created_at)
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- ═══════════════════════════════════════════════════════════════ creator summary
create or replace view public.creator_stats with (security_invoker = true) as
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
  (select count(*) from public.follows f where f.follower_id = p.id)::int as following,
  (select coalesce(sum(s.vote_count), 0) from public.templates t join public.template_stats s on s.template_id = t.id
    where t.owner_id = p.id and t.status = 'published')::int as votes_received,
  (select count(*) from public.dev_awards d where d.user_id = p.id)::int as dev_awards
from public.profiles p
where p.deleted_at is null;

-- ═══════════════════════════════════════════════════════════════ function grants
revoke execute on function
  public.guard_yowkbit_ledger(), public.grant_signup_yowkbits(), public.guard_votes(), public.on_vote_change(),
  public.cast_vote(uuid), public.ranking_period_end(public.award_period, date),
  public.ranking_period_start(public.award_period, timestamptz), public.guard_dev_awards(),
  public.grant_dev_of_week(date), public.ranking_templates(public.award_period, int), public.ranking_devs(int)
from public, anon, authenticated;

grant execute on function public.cast_vote(uuid) to authenticated;
grant execute on function
  public.ranking_templates(public.award_period, int), public.ranking_devs(int),
  public.ranking_period_start(public.award_period, timestamptz), public.ranking_period_end(public.award_period, date)
to anon, authenticated;
grant execute on function public.grant_dev_of_week(date) to service_role;

-- Dev of the Week is decided Monday 00:06 UTC for the week that just ended.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dev-of-week', '6 0 * * 1', $j$select public.grant_dev_of_week(current_date - 7)$j$);
  end if;
end $$;
