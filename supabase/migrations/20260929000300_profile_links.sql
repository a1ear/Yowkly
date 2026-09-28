-- Profile links (LinkedIn, Dribbble, Behance, Instagram, YouTube) and the
-- cover photo on the public profile.
--
-- Links are stored as HANDLES, never as URLs: the app builds the URL from a
-- fixed domain, so a profile can't carry a javascript: link or a look-alike
-- phishing domain. The cover photo already had a column (banner_path) whose
-- path is pinned to the owner's folder by the "profiles: update self" policy.

alter table public.profiles
  add column linkedin  text check (linkedin  ~ '^[A-Za-z0-9-]{3,100}$'),
  add column dribbble  text check (dribbble  ~ '^[A-Za-z0-9_-]{2,40}$'),
  add column behance   text check (behance   ~ '^[A-Za-z0-9_-]{3,40}$'),
  add column instagram text check (instagram ~ '^[A-Za-z0-9_.]{1,30}$'),
  add column youtube   text check (youtube   ~ '^[A-Za-z0-9_.-]{3,30}$');

grant update (linkedin, dribbble, behance, instagram, youtube) on public.profiles to authenticated;

-- Deleting an account clears the new fields too.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  update public.profiles
     set deleted_at = now(), bio = null, website = null, github = null, x_handle = null,
         linkedin = null, dribbble = null, behance = null, instagram = null, youtube = null,
         location = null, skills = '{}', available_for_hire = false, avatar_path = null, banner_path = null
   where id = v_uid;
  update public.templates set status = 'unlisted'
   where owner_id = v_uid and status = 'published';
  delete from public.follows where follower_id = v_uid or followee_id = v_uid;
  insert into public.moderation_log (actor_id, action, target_type, target_id)
  values (v_uid, 'delete_account', 'profile', v_uid);
end $$;

-- The profile header reads everything from creator_stats; new columns go at the end.
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
  (select count(*) from public.dev_awards d where d.user_id = p.id)::int as dev_awards,
  p.banner_path, p.linkedin, p.dribbble, p.behance, p.instagram, p.youtube
from public.profiles p
where p.deleted_at is null;

-- Replacing an avatar or cover deletes the old file, and Storage only deletes
-- objects the caller can SELECT. Owners may see their own folder (the bucket is
-- public for reading anyway; this only enables delete/list of your own files).
create policy "avatars: owner reads own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
