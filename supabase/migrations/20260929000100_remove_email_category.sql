-- Email templates are no longer a Yowkly category.
-- Refuses to run if anything already points at it, so no template or award
-- silently loses its category; recategorise those first, then re-run.
do $$
declare v_id smallint;
begin
  select id into v_id from public.categories where slug = 'email';
  if v_id is null then return; end if;
  if exists (select 1 from public.categories where parent_id = v_id)
     or exists (select 1 from public.templates where category_id = v_id)
     or exists (select 1 from public.awards where category_id = v_id) then
    raise exception 'Category "email" is still in use; recategorise its templates before removing it';
  end if;
  delete from public.user_interest_categories where category_id = v_id;
  delete from public.categories where id = v_id;
end $$;
