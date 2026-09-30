-- Inspo: showcase-only work. A website or design to look at and learn from,
-- with nothing to download. Enforced here, not just hidden in the UI:
--   * no files and no source links on an Inspo template (and a template that
--     has them can't be moved into Inspo),
--   * its license is the fixed 'SHOWCASE' (all rights stay with the creator),
--     and no other category may use that license.
-- Also: presentation tags (PowerPoint, Keynote, Google Slides, Pitch deck).

insert into public.licenses (code, name, url, summary, allows_commercial, requires_attribution, sort) values
  ('SHOWCASE', 'Showcase only', null,
   'Shown for inspiration. There is nothing to download, and all rights stay with the creator.', false, false, 9)
on conflict (code) do nothing;

insert into public.categories (slug, name, kind, sort, description) values
  ('inspo', 'Inspo', 'inspo', 0, 'Websites and designs to look at and learn from. Showcase only, nothing to download.')
on conflict (slug) do nothing;

insert into public.categories (slug, name, kind, sort, parent_id)
select v.slug, v.name, p.kind, v.sort, p.id
from (values
  ('inspo-websites', 'Websites', 1), ('inspo-landing-pages', 'Landing pages', 2),
  ('inspo-portfolios', 'Portfolios', 3), ('inspo-dashboards', 'Dashboards', 4),
  ('inspo-mobile', 'Mobile apps', 5), ('inspo-branding', 'Branding', 6)
) as v (slug, name, sort)
join public.categories p on p.slug = 'inspo'
on conflict (slug) do nothing;

insert into public.tags (slug, name, type) values
  ('powerpoint', 'PowerPoint (PPT)', 'tool'), ('keynote', 'Keynote', 'tool'),
  ('google-slides', 'Google Slides', 'tool'), ('pitch-deck', 'Pitch deck', 'style')
on conflict (slug) do nothing;

-- Tags suggested for each category (shown as quick filters on the Categories page).
create table public.category_featured_tags (
  category_id smallint not null references public.categories (id) on delete cascade,
  tag_id      integer  not null references public.tags (id) on delete cascade,
  sort        smallint not null default 0,
  primary key (category_id, tag_id)
);
alter table public.category_featured_tags enable row level security;
revoke all on public.category_featured_tags from anon, authenticated;
grant select on public.category_featured_tags to anon, authenticated;
create policy "featured tags: public" on public.category_featured_tags for select using (true);

insert into public.category_featured_tags (category_id, tag_id, sort)
select c.id, t.id, v.sort
from (values ('canva', 1), ('powerpoint', 2), ('google-slides', 3), ('keynote', 4), ('pitch-deck', 5), ('figma', 6)) as v (tag, sort)
join public.tags t on t.slug = v.tag
join public.categories c on c.slug = 'presentations'
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════ Inspo rules
create function public.is_inspo_template(p_template uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.templates t join public.categories c on c.id = t.category_id
                  where t.id = p_template and c.kind = 'inspo');
$$;

create function public.guard_inspo_downloads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_inspo_template(new.template_id) then
    raise exception 'Inspo is showcase only: no downloadable files or source links' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger template_files_no_inspo before insert on public.template_files
  for each row execute function public.guard_inspo_downloads();
create trigger template_links_no_inspo before insert on public.template_links
  for each row execute function public.guard_inspo_downloads();

create function public.guard_inspo_category() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.category_id is distinct from old.category_id
     and exists (select 1 from public.categories where id = new.category_id and kind = 'inspo')
     and (exists (select 1 from public.template_files where template_id = new.id)
          or exists (select 1 from public.template_links where template_id = new.id)) then
    raise exception 'Remove the files and source links before moving this to Inspo' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger templates_guard_inspo_category before update of category_id on public.templates
  for each row execute function public.guard_inspo_category();

-- SHOWCASE belongs to Inspo and Inspo only.
create function public.guard_showcase_license() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_inspo boolean := public.is_inspo_template(new.template_id);
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if v_inspo and new.license_code is distinct from 'SHOWCASE' then
      raise exception 'Inspo uses the Showcase only license' using errcode = '23514';
    elsif not v_inspo and new.license_code = 'SHOWCASE' then
      raise exception 'Showcase only is for Inspo. Choose a license people can download under' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger template_versions_showcase_license before update of status on public.template_versions
  for each row execute function public.guard_showcase_license();

revoke execute on function public.guard_inspo_downloads(), public.guard_inspo_category(), public.guard_showcase_license()
  from public, anon, authenticated;
grant execute on function public.is_inspo_template(uuid) to anon, authenticated;
