-- Yowkly core schema.
-- Conventions:
--   * Every table has RLS enabled (see 20260927000300_rls.sql). Default is deny.
--   * anon/authenticated get NO table privileges by default; each grant is explicit
--     and column-scoped where the client may write.
--   * owner_id is denormalised onto child tables so RLS never needs a join to
--     answer "is this mine?". Triggers set it; clients cannot.
--   * Published records are immutable (versions, awards, downloads, moderation_log).

create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Lock down defaults for anything created by migrations from here on.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- EXECUTE-to-PUBLIC is a global default; a per-schema revoke cannot remove it.
alter default privileges revoke execute on functions from public;

-- ─────────────────────────────────────────────────────────────── enums
create type public.template_status as enum ('draft', 'pending_review', 'published', 'unlisted', 'removed');
create type public.version_status  as enum ('draft', 'published', 'yanked');
create type public.scan_status     as enum ('pending', 'scanning', 'clean', 'infected', 'rejected');
create type public.source_tool     as enum ('code', 'figma', 'psd', 'canva', 'sketch', 'xd', 'ai', 'penpot', 'pdf');
create type public.link_kind       as enum ('github', 'figma', 'canva', 'framer', 'webflow', 'penpot');
create type public.app_role        as enum ('moderator', 'admin', 'juror');
create type public.media_kind      as enum ('cover', 'gallery', 'mobile_screen');
create type public.device_kind     as enum ('desktop', 'tablet', 'mobile');
create type public.category_kind   as enum ('web', 'mobile', 'kit', 'component', 'other', 'concept');
create type public.tag_type        as enum ('stack', 'tool', 'style', 'industry');
create type public.award_period    as enum ('day', 'week', 'month');
create type public.report_target   as enum ('template', 'comment', 'profile', 'collection');
create type public.report_status   as enum ('open', 'resolved', 'dismissed');
create type public.notification_type as enum (
  'follow', 'like_milestone', 'comment', 'reply', 'award',
  'upload_approved', 'upload_rejected', 'template_removed', 'scan_failed'
);

-- ─────────────────────────────────────────────────────────────── helpers
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────── identity
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  username           extensions.citext not null unique
                       check (username ~ '^[A-Za-z0-9_]{3,30}$'),
  display_name       text not null check (char_length(display_name) between 1 and 60),
  bio                text check (char_length(bio) <= 500),
  avatar_path        text,
  banner_path        text,
  website            text check (website ~ '^https://\S+$' and char_length(website) <= 300),
  github             text check (github ~ '^[A-Za-z0-9-]{1,39}$'),
  x_handle           text check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  location           text check (char_length(location) <= 80),
  skills             text[] not null default '{}' check (cardinality(skills) <= 15),
  available_for_hire boolean not null default false,
  hide_likes         boolean not null default false,
  trust_level        smallint not null default 0 check (trust_level between 0 and 3),
  onboarded_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create table public.reserved_usernames (username extensions.citext primary key);
insert into public.reserved_usernames (username) values
  ('admin'), ('administrator'), ('api'), ('app'), ('auth'), ('awards'), ('dashboard'),
  ('explore'), ('for-you'), ('foryou'), ('help'), ('yowkly'), ('nightpatch'), ('legal'), ('login'),
  ('logout'), ('moderator'), ('mod'), ('notifications'), ('root'), ('search'),
  ('settings'), ('signin'), ('signup'), ('staff'), ('support'), ('system'), ('upload'),
  ('www'), ('null'), ('undefined');

create table public.user_roles (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ─────────────────────────────────────────────────────────────── taxonomy
create table public.categories (
  id          smallint generated always as identity primary key,
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null,
  description text,
  parent_id   smallint references public.categories (id),
  kind        public.category_kind not null,
  sort        smallint not null default 0
);

create table public.tags (
  id   integer generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),
  name text not null,
  type public.tag_type not null
);

create table public.licenses (
  code                 text primary key,
  name                 text not null,
  url                  text,
  summary              text not null,
  allows_commercial    boolean not null,
  requires_attribution boolean not null,
  sort                 smallint not null default 0
);

-- ─────────────────────────────────────────────────────────────── templates
create table public.templates (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles (id) on delete cascade,
  slug               extensions.citext not null unique
                       check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 90),
  title              text not null check (char_length(title) between 3 and 80),
  tagline            text check (char_length(tagline) <= 140),
  description        text check (char_length(description) <= 10000),
  category_id        smallint references public.categories (id),
  status             public.template_status not null default 'draft',
  demo_url           text check (demo_url ~ '^https://\S+$' and char_length(demo_url) <= 500),
  cover_path         text,                -- maintained by trigger from template_media
  current_version_id uuid,                -- FK added below
  status_reason      text check (char_length(status_reason) <= 1000),
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  search_tsv         tsvector generated always as (
      setweight(to_tsvector('english', coalesce(title, '')), 'A')
   || setweight(to_tsvector('english', coalesce(tagline, '')), 'B')
   || setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored
);
create trigger templates_touch before update on public.templates
  for each row execute function public.touch_updated_at();

-- Counters live in their own narrow table so a viral template's likes do not
-- rewrite the wide templates row (description, tsvector) on every tap.
create table public.template_stats (
  template_id     uuid primary key references public.templates (id) on delete cascade,
  like_count      integer not null default 0,
  save_count      integer not null default 0,
  comment_count   integer not null default 0,
  download_count  integer not null default 0,
  view_count      bigint  not null default 0,
  vote_count      integer not null default 0,
  weight_sum      numeric not null default 0,
  score_sum       numeric not null default 0,   -- Σ score·weight
  design_sum      numeric not null default 0,   -- Σ criterion·weight
  usability_sum   numeric not null default 0,
  creativity_sum  numeric not null default 0,
  code_sum        numeric not null default 0,
  code_weight_sum numeric not null default 0,
  hot_score       double precision not null default 0,
  updated_at      timestamptz not null default now()
);

create table public.template_tags (
  template_id uuid not null references public.templates (id) on delete cascade,
  tag_id      integer not null references public.tags (id) on delete cascade,
  owner_id    uuid not null,
  primary key (template_id, tag_id)
);

create table public.template_links (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  owner_id    uuid not null,
  kind        public.link_kind not null,
  url         text not null check (char_length(url) <= 500),
  created_at  timestamptz not null default now(),
  unique (template_id, kind),
  -- Host allowlist enforced in the database, not only in the form.
  check (
    case kind
      when 'github'  then url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$'
      when 'figma'   then url ~ '^https://(www\.)?figma\.com/(file|design|proto|community/file)/\S+$'
      when 'canva'   then url ~ '^https://(www\.)?canva\.com/design/\S+$'
      when 'framer'  then url ~ '^https://(www\.)?framer\.com/(projects|remix|marketplace)/\S+$'
      when 'webflow' then url ~ '^https://(www\.)?webflow\.com/made-in-webflow/website/\S+$'
      when 'penpot'  then url ~ '^https://design\.penpot\.app/\S+$'
    end
  )
);

create table public.template_versions (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid not null references public.templates (id) on delete cascade,
  owner_id          uuid not null,
  version           text not null check (version ~ '^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$'),
  changelog         text check (char_length(changelog) <= 5000),
  license_code      text references public.licenses (code),
  price_cents       integer check (price_cents is null),  -- reserved for a future marketplace
  status            public.version_status not null default 'draft',
  yank_reason       text check (char_length(yank_reason) <= 300),
  rights_attested_at timestamptz,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (template_id, version),
  check (status <> 'yanked' or yank_reason is not null),
  check (status = 'draft' or (license_code is not null and rights_attested_at is not null and published_at is not null))
);

alter table public.templates
  add constraint templates_current_version_fk
  foreign key (current_version_id) references public.template_versions (id) on delete set null;

create table public.template_files (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references public.template_versions (id) on delete cascade,
  template_id    uuid not null references public.templates (id) on delete cascade,
  owner_id       uuid not null,
  bucket         text not null default 'quarantine' check (bucket in ('quarantine', 'template-files')),
  storage_path   text not null unique,
  original_name  text not null check (char_length(original_name) between 1 and 200),
  ext            text not null check (ext in ('zip', 'fig', 'psd', 'ai', 'sketch', 'xd', 'penpot', 'pdf')),
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 209715200), -- 200 MB
  sha256         text check (sha256 ~ '^[0-9a-f]{64}$'),
  source_tool    public.source_tool not null,
  scan_status    public.scan_status not null default 'pending',
  scan_attempts  smallint not null default 0,
  scan_started_at timestamptz,
  scanned_at     timestamptz,
  reject_reason  text check (char_length(reject_reason) <= 500),  -- shown to the owner
  scan_report    jsonb,                                            -- internal only
  manifest       jsonb,                                            -- zip file tree, public once clean
  created_at     timestamptz not null default now()
);

create table public.template_media (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  owner_id    uuid not null,
  path        text not null unique,
  kind        public.media_kind not null,
  device      public.device_kind not null default 'desktop',
  width       integer check (width between 1 and 10000),
  height      integer check (height between 1 and 20000),
  alt_text    text not null check (char_length(btrim(alt_text)) between 3 and 250),
  sort        smallint not null default 0,
  created_at  timestamptz not null default now()
);
create unique index template_media_one_cover on public.template_media (template_id) where kind = 'cover';

-- ─────────────────────────────────────────────────────────────── engagement
create table public.likes (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  template_id uuid not null references public.templates (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, template_id)
);

create table public.votes (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  template_id  uuid not null references public.templates (id) on delete cascade,
  design       smallint not null check (design between 1 and 10),
  usability    smallint not null check (usability between 1 and 10),
  creativity   smallint not null check (creativity between 1 and 10),
  code_quality smallint check (code_quality between 1 and 10),
  -- Design 40 / Usability 30 / Creativity 20 / Code 10; re-weighted when code is not rated.
  score        numeric(4, 2) generated always as (
    case when code_quality is null
      then round((design * 0.4 + usability * 0.3 + creativity * 0.2) / 0.9, 2)
      else round(design * 0.4 + usability * 0.3 + creativity * 0.2 + code_quality * 0.1, 2)
    end
  ) stored,
  weight       numeric(3, 1) not null default 1.0,   -- set by trigger (jurors 3.0)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, template_id)
);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table public.collections (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (char_length(description) <= 300),
  is_public   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger collections_touch before update on public.collections
  for each row execute function public.touch_updated_at();

create table public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  template_id   uuid not null references public.templates (id) on delete cascade,
  owner_id      uuid not null,
  note          text check (char_length(note) <= 200),
  created_at    timestamptz not null default now(),
  primary key (collection_id, template_id)
);

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  parent_id   uuid references public.comments (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.license_acceptances (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  license_code text not null references public.licenses (code),
  accepted_at  timestamptz not null default now(),
  primary key (user_id, license_code)
);

-- Append-only. Snapshots version and license at the moment of download.
create table public.downloads (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles (id) on delete set null,
  template_id  uuid not null references public.templates (id) on delete cascade,
  version_id   uuid references public.template_versions (id) on delete set null,
  file_id      uuid references public.template_files (id) on delete set null,
  link_kind    public.link_kind,
  license_code text references public.licenses (code),
  created_at   timestamptz not null default now(),
  check (file_id is null or link_kind is null)
);

create table public.template_view_daily (
  template_id uuid not null references public.templates (id) on delete cascade,
  day         date not null,
  views       integer not null default 0 check (views >= 0),
  primary key (template_id, day)
);

create table public.user_interest_categories (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  category_id smallint not null references public.categories (id) on delete cascade,
  primary key (user_id, category_id)
);

create table public.user_interest_tags (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tag_id  integer not null references public.tags (id) on delete cascade,
  primary key (user_id, tag_id)
);

create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        public.notification_type not null,
  actor_id    uuid references public.profiles (id) on delete set null,
  template_id uuid references public.templates (id) on delete cascade,
  comment_id  uuid references public.comments (id) on delete cascade,
  data        jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Immutable once written. A template can win each award kind once.
create table public.awards (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references public.templates (id) on delete cascade,
  period              public.award_period not null,
  period_start        date not null,
  category_id         smallint references public.categories (id),
  score_snapshot      numeric(5, 3) not null,
  vote_count_snapshot integer not null,
  blurb               text check (char_length(blurb) <= 400),
  created_at          timestamptz not null default now(),
  unique nulls not distinct (period, period_start, category_id),
  unique nulls not distinct (template_id, period, category_id)
);

create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid references public.profiles (id) on delete set null,
  target_type     public.report_target not null,
  target_id       uuid not null,
  reason          text not null check (reason in ('spam', 'malware', 'copyright', 'inappropriate', 'broken', 'other')),
  details         text check (char_length(details) <= 1000),
  status          public.report_status not null default 'open',
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolution_note text check (char_length(resolution_note) <= 1000),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- Append-only audit trail. Nobody may update or delete (enforced by trigger too).
create table public.moderation_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   uuid not null,
  reason      text,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────── indexes
create index templates_status_published_idx on public.templates (status, published_at desc);
create index templates_category_idx         on public.templates (category_id, status, published_at desc);
create index templates_owner_idx            on public.templates (owner_id, created_at desc);
create index templates_search_idx           on public.templates using gin (search_tsv);
create index templates_title_trgm_idx       on public.templates using gin (title extensions.gin_trgm_ops);
create index template_stats_hot_idx         on public.template_stats (hot_score desc);
create index template_tags_tag_idx          on public.template_tags (tag_id, template_id);
create index template_versions_tpl_idx      on public.template_versions (template_id, created_at desc);
create index template_files_version_idx     on public.template_files (version_id);
create index template_files_queue_idx       on public.template_files (created_at) where scan_status in ('pending', 'scanning');
create index template_files_sha_idx         on public.template_files (sha256) where sha256 is not null;
create index template_media_tpl_idx         on public.template_media (template_id, sort);
create index likes_template_idx             on public.likes (template_id);
create index likes_user_idx                 on public.likes (user_id, created_at desc);
create index votes_template_idx             on public.votes (template_id);
create index follows_followee_idx           on public.follows (followee_id);
create index collections_owner_idx          on public.collections (owner_id);
create index collection_items_template_idx  on public.collection_items (template_id);
create index comments_template_idx          on public.comments (template_id, created_at);
create index downloads_template_idx         on public.downloads (template_id, created_at desc);
create index downloads_user_idx             on public.downloads (user_id, created_at desc);
create index notifications_user_idx         on public.notifications (user_id, created_at desc);
create index notifications_unread_idx       on public.notifications (user_id) where read_at is null;
create index awards_period_idx              on public.awards (period, period_start desc);
create index reports_open_idx               on public.reports (created_at) where status = 'open';
create index moderation_log_target_idx      on public.moderation_log (target_type, target_id);
create index user_roles_role_idx            on public.user_roles (role);

-- ─────────────────────────────────────────────────────────────── default deny
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
