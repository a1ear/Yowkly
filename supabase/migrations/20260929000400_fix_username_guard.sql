-- Username fixes found while testing profile editing on real Supabase.
--
-- 1. The reserved-username trigger ran with the caller's rights, but clients
--    (correctly) have no access to reserved_usernames, so every profile save
--    or onboarding step that sent a username failed with "permission denied".
--    It now runs as its owner, like the other guards; the table stays private.
--
-- 2. With search_path = '' a bare "=" between citext values resolves to plain
--    text equality, so these checks were case-sensitive: "Admin" or "Support"
--    slipped past the reserved list, and a sign-up whose handle differed only
--    in case from an existing user ("Alice" vs "alice") failed on the unique
--    index instead of getting a free variant. Use citext's own operator.

create or replace function public.guard_username() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.reserved_usernames r where r.username operator(extensions.=) new.username) then
    raise exception 'That username is reserved' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_base text;
  v_name text;
  v_try  text;
  v_i    int := 0;
begin
  v_base := coalesce(
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'preferred_username',
    split_part(new.email, '@', 1),
    'user'
  );
  v_base := left(regexp_replace(v_base, '[^A-Za-z0-9_]', '', 'g'), 24);
  if char_length(v_base) < 3 then v_base := 'user' || v_base; end if;

  v_name := coalesce(
    nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 60), ''),
    nullif(left(btrim(new.raw_user_meta_data ->> 'name'), 60), ''),
    v_base
  );

  v_try := v_base;
  while exists (select 1 from public.profiles where username operator(extensions.=) v_try::extensions.citext)
     or exists (select 1 from public.reserved_usernames where username operator(extensions.=) v_try::extensions.citext) loop
    v_i := v_i + 1;
    v_try := left(v_base, 24) || '_' || substr(md5(random()::text), 1, 4);
    if v_i > 20 then raise exception 'Could not allocate a username'; end if;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_try, v_name);
  return new;
end $$;

revoke execute on function public.guard_username(), public.handle_new_user() from public, anon, authenticated;
