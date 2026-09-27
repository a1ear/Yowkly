-- Row Level Security + explicit, column-scoped privileges.
-- Rule of thumb: a policy decides WHICH ROWS, a grant decides WHICH COLUMNS.
-- auth.uid() is always wrapped as (select auth.uid()) so Postgres evaluates it
-- once per statement instead of once per row.

-- Identity columns default to the caller, and clients are never granted them,
-- so a client cannot even try to act as someone else.
alter table public.likes                    alter column user_id     set default auth.uid();
alter table public.votes                    alter column user_id     set default auth.uid();
alter table public.follows                  alter column follower_id set default auth.uid();
alter table public.collections              alter column owner_id    set default auth.uid();
alter table public.comments                 alter column author_id   set default auth.uid();
alter table public.reports                  alter column reporter_id set default auth.uid();
alter table public.user_interest_categories alter column user_id     set default auth.uid();
alter table public.user_interest_tags       alter column user_id     set default auth.uid();

-- Every table: RLS on.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────── reference data
grant select on public.categories, public.tags, public.licenses to anon, authenticated;
create policy "reference: read" on public.categories for select using (true);
create policy "reference: read" on public.tags       for select using (true);
create policy "reference: read" on public.licenses   for select using (true);
-- reserved_usernames: no client access at all (RLS on, no policy, no grant).

-- ─────────────────────────────────────────────────────────────── profiles
grant select on public.profiles to anon, authenticated;
grant update (username, display_name, bio, avatar_path, banner_path, website, github, x_handle,
              location, skills, available_for_hire, hide_likes, onboarded_at)
  on public.profiles to authenticated;

create policy "profiles: read active" on public.profiles for select
  using (deleted_at is null or id = (select auth.uid()));
create policy "profiles: update self" on public.profiles for update to authenticated
  using (id = (select auth.uid()) and deleted_at is null)
  with check (
    id = (select auth.uid())
    and (avatar_path is null or avatar_path like (select auth.uid())::text || '/%')
    and (banner_path is null or banner_path like (select auth.uid())::text || '/%')
  );

-- ─────────────────────────────────────────────────────────────── roles
grant select on public.user_roles to authenticated;
grant insert (user_id, role), delete on public.user_roles to authenticated;
create policy "roles: read own or admin" on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "roles: admin grants" on public.user_roles for insert to authenticated
  with check ((select public.is_admin()));
create policy "roles: admin revokes" on public.user_roles for delete to authenticated
  using ((select public.is_admin()));

-- ─────────────────────────────────────────────────────────────── templates
grant select on public.templates to anon, authenticated;
grant update (title, tagline, description, category_id, demo_url) on public.templates to authenticated;
grant delete on public.templates to authenticated;

create policy "templates: public or own or mod" on public.templates for select
  using (
    status in ('published', 'unlisted')
    or owner_id = (select auth.uid())
    or (select public.is_moderator())
  );
create policy "templates: owner edits metadata" on public.templates for update to authenticated
  using (owner_id = (select auth.uid()) and status <> 'removed')
  with check (owner_id = (select auth.uid()) and status <> 'removed');
create policy "templates: owner deletes drafts" on public.templates for delete to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft' and published_at is null);

-- Child tables: "visible if the parent template is visible" reuses the templates
-- policy through the subquery, so the rule is written once.
grant select on public.template_stats to anon, authenticated;
create policy "stats: follow template" on public.template_stats for select
  using (exists (select 1 from public.templates t where t.id = template_id));

grant select on public.template_tags to anon, authenticated;
create policy "tags: follow template" on public.template_tags for select
  using (exists (select 1 from public.templates t where t.id = template_id));

grant select on public.template_links to anon, authenticated;
grant insert (template_id, kind, url), update (url), delete on public.template_links to authenticated;
create policy "links: follow template" on public.template_links for select
  using (exists (select 1 from public.templates t where t.id = template_id));
create policy "links: owner adds" on public.template_links for insert to authenticated
  with check (exists (select 1 from public.templates t
                       where t.id = template_id and t.owner_id = (select auth.uid()) and t.status <> 'removed'));
create policy "links: owner edits" on public.template_links for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "links: owner deletes" on public.template_links for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select on public.template_versions to anon, authenticated;
grant update (version, changelog, license_code), delete on public.template_versions to authenticated;
create policy "versions: released public, drafts owner" on public.template_versions for select
  using (
    exists (select 1 from public.templates t where t.id = template_id)
    and (status <> 'draft' or owner_id = (select auth.uid()) or (select public.is_moderator()))
  );
create policy "versions: owner edits draft" on public.template_versions for update to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft')
  with check (owner_id = (select auth.uid()) and status = 'draft');
create policy "versions: owner deletes draft" on public.template_versions for delete to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft');

-- Files: storage_path, bucket and scan_report are never exposed to clients.
grant select (id, version_id, template_id, owner_id, original_name, ext, size_bytes, sha256, source_tool,
              scan_status, reject_reason, manifest, created_at, scanned_at)
  on public.template_files to anon, authenticated;
grant delete on public.template_files to authenticated;
create policy "files: clean+released public, rest owner" on public.template_files for select
  using (
    owner_id = (select auth.uid())
    or (select public.is_moderator())
    or (scan_status = 'clean'
        and exists (select 1 from public.templates t where t.id = template_id)
        and exists (select 1 from public.template_versions v where v.id = version_id and v.status <> 'draft'))
  );
create policy "files: owner deletes from draft" on public.template_files for delete to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.template_versions v where v.id = version_id and v.status = 'draft'));

grant select on public.template_media to anon, authenticated;
grant update (alt_text, sort, device), delete on public.template_media to authenticated;
create policy "media: follow template" on public.template_media for select
  using (exists (select 1 from public.templates t where t.id = template_id));
create policy "media: owner edits" on public.template_media for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "media: owner deletes" on public.template_media for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Owner-only analytics.
grant select on public.template_view_daily to authenticated;
create policy "views: owner or mod" on public.template_view_daily for select to authenticated
  using (exists (select 1 from public.templates t
                  where t.id = template_id and (t.owner_id = (select auth.uid()) or (select public.is_moderator()))));

-- ─────────────────────────────────────────────────────────────── likes
grant select on public.likes to anon, authenticated;
grant insert (template_id), delete on public.likes to authenticated;
create policy "likes: read unless hidden" on public.likes for select
  using (
    user_id = (select auth.uid())
    or not exists (select 1 from public.profiles p where p.id = user_id and p.hide_likes)
  );
create policy "likes: like visible published" on public.likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.templates t
                 where t.id = template_id and t.status in ('published', 'unlisted'))
  );
create policy "likes: unlike own" on public.likes for delete to authenticated
  using (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────── votes
-- Raw votes are private; the public sees aggregates in template_stats.
grant select on public.votes to authenticated;
grant insert (template_id, design, usability, creativity, code_quality),
      update (design, usability, creativity, code_quality),
      delete on public.votes to authenticated;
create policy "votes: read own or admin" on public.votes for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "votes: eligible voters" on public.votes for insert to authenticated
  with check (user_id = (select auth.uid()) and public.vote_eligibility(template_id) = 'ok');
create policy "votes: edit own" on public.votes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.vote_eligibility(template_id) = 'ok');
create policy "votes: retract own" on public.votes for delete to authenticated
  using (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────── follows
grant select on public.follows to anon, authenticated;
grant insert (followee_id), delete on public.follows to authenticated;
create policy "follows: read" on public.follows for select using (true);
create policy "follows: follow as self" on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid())
              and exists (select 1 from public.profiles p where p.id = followee_id and p.deleted_at is null));
create policy "follows: unfollow own" on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────── collections
-- A private collection is invisible to others: it answers 404, not 403, so its
-- existence is not leaked.
grant select on public.collections to anon, authenticated;
grant insert (name, description, is_public), update (name, description, is_public), delete
  on public.collections to authenticated;
create policy "collections: public or own" on public.collections for select
  using (is_public or owner_id = (select auth.uid()));
create policy "collections: create own" on public.collections for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "collections: edit own" on public.collections for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "collections: delete own" on public.collections for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select on public.collection_items to anon, authenticated;
grant insert (collection_id, template_id, note), update (note), delete on public.collection_items to authenticated;
create policy "items: follow collection" on public.collection_items for select
  using (exists (select 1 from public.collections c where c.id = collection_id)
         and exists (select 1 from public.templates t where t.id = template_id));
create policy "items: add to own" on public.collection_items for insert to authenticated
  with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid()))
    and exists (select 1 from public.templates t where t.id = template_id and t.status in ('published', 'unlisted'))
  );
create policy "items: edit own" on public.collection_items for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "items: remove own" on public.collection_items for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────── comments
grant select on public.comments to anon, authenticated;
grant insert (template_id, parent_id, body), update (body) on public.comments to authenticated;
create policy "comments: follow template" on public.comments for select
  using (exists (select 1 from public.templates t where t.id = template_id));
create policy "comments: verified users comment" on public.comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (select public.auth_email_verified())
    and exists (select 1 from public.templates t where t.id = template_id and t.status = 'published')
  );
create policy "comments: edit own within 15 min" on public.comments for update to authenticated
  using (author_id = (select auth.uid()) and deleted_at is null and created_at > now() - interval '15 minutes')
  with check (author_id = (select auth.uid()) and deleted_at is null);

-- ─────────────────────────────────────────────────────────────── downloads, licenses
grant select on public.downloads to authenticated;
create policy "downloads: own history" on public.downloads for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.license_acceptances to authenticated;
create policy "acceptances: own" on public.license_acceptances for select to authenticated
  using (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────── interests
grant select, insert (category_id), delete on public.user_interest_categories to authenticated;
create policy "interests: own" on public.user_interest_categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert (tag_id), delete on public.user_interest_tags to authenticated;
create policy "interests: own" on public.user_interest_tags for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────── notifications
grant select on public.notifications to authenticated;
create policy "notifications: own" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────── awards
grant select on public.awards to anon, authenticated;
create policy "awards: follow template" on public.awards for select
  using (exists (select 1 from public.templates t where t.id = template_id));

-- ─────────────────────────────────────────────────────────────── reports, moderation
grant select on public.reports to authenticated;
grant insert (target_type, target_id, reason, details) on public.reports to authenticated;
create policy "reports: own or mod" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public.is_moderator()));
create policy "reports: file as self" on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));

grant select on public.moderation_log to authenticated;
create policy "modlog: moderators read" on public.moderation_log for select to authenticated
  using ((select public.is_moderator()));
