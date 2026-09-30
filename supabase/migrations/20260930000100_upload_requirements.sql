-- Upload requirements the form asks for, enforced where the form can't be skipped.
--
-- 1. Live demo URLs must be the creator's own site: not a search engine, social
--    network, video site, chat app or link shortener. Mirrors src/lib/demo-url.ts.
-- 2. A version can only be published when the template has a tagline, a real
--    description and at least one tag. Already-published templates are untouched;
--    the rule applies from their next publish.

create function public.demo_host_blocked(p_url text) returns boolean
language sql immutable set search_path = '' as $$
  with h as (
    select lower(rtrim(substring(p_url from '^https?://(?:[^@/]*@)?([^:/?#]+)'), '.')) as host
  )
  select coalesce(
    (select host from h) is null
    or exists (
      select 1 from unnest(array[
        'google.com','bing.com','yahoo.com','duckduckgo.com','baidu.com','yandex.ru','wikipedia.org',
        'amazon.com','apple.com','microsoft.com','netflix.com','ebay.com',
        'facebook.com','fb.com','instagram.com','threads.net','twitter.com','x.com','tiktok.com',
        'linkedin.com','reddit.com','pinterest.com','snapchat.com','tumblr.com','quora.com',
        'youtube.com','youtu.be','vimeo.com','twitch.tv','dailymotion.com',
        'whatsapp.com','wa.me','t.me','telegram.org','discord.com','discord.gg','messenger.com',
        'bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','is.gd','buff.ly','rebrand.ly','cutt.ly','shorturl.at'
      ]) b(d), h
      where h.host = b.d or h.host like '%.' || b.d
    )
    or (select host from h) ~ '(^|\.)(google|amazon|facebook|youtube|yahoo|bing)\.[a-z]{2,3}(\.[a-z]{2})?$',
  true);
$$;

create function public.guard_demo_url() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Malformed URLs are left to the column's own check constraint.
  if new.demo_url ~ '^https://' and new.demo_url is distinct from old.demo_url and public.demo_host_blocked(new.demo_url) then
    raise exception 'That site can''t be used as a live demo. Link to your own site.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger templates_guard_demo_url before update of demo_url on public.templates
  for each row execute function public.guard_demo_url();

create function public.guard_publish_requirements() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tpl record;
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    select tagline, description into v_tpl from public.templates where id = new.template_id;
    if char_length(btrim(coalesce(v_tpl.tagline, ''))) < 10 then
      raise exception 'Add a tagline (at least 10 characters)' using errcode = '23514';
    end if;
    if char_length(btrim(coalesce(v_tpl.description, ''))) < 30 then
      raise exception 'Add a description (at least 30 characters)' using errcode = '23514';
    end if;
    if not exists (select 1 from public.template_tags where template_id = new.template_id) then
      raise exception 'Add at least one tag' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger template_versions_publish_requirements before update of status on public.template_versions
  for each row execute function public.guard_publish_requirements();

revoke execute on function public.guard_demo_url(), public.guard_publish_requirements() from public, anon, authenticated;
-- Pure check, used by the trigger as the calling user (and handy for the app).
grant execute on function public.demo_host_blocked(text) to anon, authenticated;
