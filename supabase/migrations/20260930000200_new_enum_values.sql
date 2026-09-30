-- New enum values live in their own migration: Postgres won't let a value be used
-- in the same transaction that adds it.
--   reviewer      = "sub-admin": may approve or request changes on pending uploads, nothing else.
--   review_needed = tells staff an upload is waiting for review.
--   inspo         = showcase-only work (a website or design to look at, nothing to download).
alter type public.app_role add value if not exists 'reviewer';
alter type public.notification_type add value if not exists 'review_needed';
alter type public.category_kind add value if not exists 'inspo';
