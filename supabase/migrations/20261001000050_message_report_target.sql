-- New enum values live in their own migration (see 20260930000200): reports can now point at a direct message.
alter type public.report_target add value if not exists 'message';
