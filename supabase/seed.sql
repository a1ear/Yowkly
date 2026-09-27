-- LOCAL DEVELOPMENT SEED ONLY. `supabase db reset` runs this; production never does.
-- Demo accounts all share one dev password: yowkly-dev-2026
-- (letters + digits, satisfies the local password policy). Never reuse it anywhere real.
-- Emails use the reserved .test TLD so nothing can ever be delivered.

do $$
declare
  v_pw text := extensions.crypt('yowkly-dev-2026', extensions.gen_salt('bf'));
  r record;
begin
  for r in select * from (values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'mara@yowkly.test',  'mara',  'Mara Lin'),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'paolo@yowkly.test', 'paolo', 'Paolo Reyes'),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'kenji@yowkly.test', 'kenji', 'Kenji Watanabe'),
    ('00000000-0000-4000-8000-000000000004'::uuid, 'amara@yowkly.test', 'amara', 'Amara Okafor'),
    ('00000000-0000-4000-8000-000000000005'::uuid, 'sofia@yowkly.test', 'sofia', 'Sofia Marín'),
    ('00000000-0000-4000-8000-000000000006'::uuid, 'dev@yowkly.test',   'devp',  'Dev Patel'),
    ('00000000-0000-4000-8000-000000000007'::uuid, 'viewer@yowkly.test','viewer','Demo Viewer'),
    ('00000000-0000-4000-8000-000000000008'::uuid, 'mod@yowkly.test',   'moddy', 'Demo Moderator')
  ) as t (id, email, handle, full_name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email, v_pw,
            now() - interval '60 days',
            '{"provider":"email","providers":["email"]}',
            jsonb_build_object('user_name', r.handle, 'full_name', r.full_name),
            now() - interval '60 days', now() - interval '60 days', '', '', '', '');
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), r.id::text, r.id,
            jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true),
            'email', now(), now() - interval '60 days', now() - interval '60 days');
  end loop;
end $$;

update public.profiles set onboarded_at = now(), trust_level = 1, created_at = now() - interval '60 days';
update public.profiles set bio = 'Product designer building calm interfaces for data-heavy SaaS.', location = 'Singapore',
       skills = '{Figma,Next.js,Design systems}', available_for_hire = true, github = 'maralin-dev'
 where username = 'mara';
update public.profiles set bio = 'Product designer · Manila. Apps for neighborhood businesses.', location = 'Manila',
       skills = '{Mobile,Figma,UX research}', available_for_hire = true where username = 'paolo';
update public.profiles set bio = 'Frontend dev · Osaka. Loud type, fast sites.', location = 'Osaka',
       skills = '{Astro,CSS,Performance}' where username = 'kenji';
update public.profiles set bio = 'UI designer · Lagos. Tools for small businesses.', location = 'Lagos',
       skills = '{Canva,Figma,Fintech}' where username = 'amara';
update public.profiles set bio = 'Design systems · Madrid.', location = 'Madrid',
       skills = '{Photoshop,Sketch,Design systems}' where username = 'sofia';
update public.profiles set bio = 'Mobile designer and Flutter developer.', location = 'Pune',
       skills = '{Flutter,Figma,Motion}' where username = 'devp';
insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-000000000008', 'moderator');

-- ─────────────────────────────────────────────── templates
create temporary table seed_t (
  id uuid, owner uuid, slug text, title text, tagline text, description text, cat text,
  demo text, license text, published_days int
) on commit drop;

insert into seed_t values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'nocturne-saas-dashboard-kit',
   'Nocturne — SaaS Dashboard Kit', 'A dark-first analytics dashboard for subscription products, in Figma and Next.js.',
   E'Nocturne ships 48 screens and 120+ components for MRR, churn and cohort reporting. Every chart is built with real Tailwind tokens, so the Figma file and the Next.js code stay in sync.\n\n- Next.js App Router, TypeScript, Tailwind\n- Light and dark themes with AA contrast\n- Auto-layout Figma components with variants\n- Chart wrappers for line, bar and donut charts',
   'dashboards', 'https://nocturne-demo.example.com', 'MIT', 3),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'tindahan-grocery-delivery-app',
   'Tindahan — Grocery Delivery App', 'A neighborhood grocery app for iOS and Android with suki rewards and COD checkout.',
   E'Tindahan is a 36-screen grocery delivery flow designed for neighborhood stores: browse by aisle, suki (loyal customer) rewards, cash-on-delivery checkout and rider tracking.\n\nBuilt with auto-layout and a small token set so it adapts to any brand.',
   'cross-platform', null, 'CC-BY-4.0', 5),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', 'brutal-folio',
   'Brutal Folio', 'A loud, fast portfolio template in Astro. Zero JS by default.',
   E'Brutal Folio is a one-page portfolio with oversized type, a case-study template and a 100 Lighthouse score out of the box.\n\nDrop in your Markdown case studies and deploy.',
   'portfolios', 'https://brutal-folio.example.com', 'MIT', 2),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', 'ledger-lite-invoicing-concept',
   'Ledger Lite — Invoicing Web App Concept', 'An invoicing concept for freelancers who hate spreadsheets.',
   E'A concept for a lightweight invoicing tool: clients, recurring invoices and a one-tap "mark as paid". Designed in Canva as a clickable walkthrough.',
   'concepts', null, 'PERSONAL', 1),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005', 'glasshouse-ui-kit',
   'Glasshouse UI Kit', 'A glassmorphism UI kit with 200+ components in Photoshop and Sketch.',
   E'Glasshouse is a layered UI kit: frosted panels, depth tokens and 200+ components organised by atomic level. Shipped as a PSD and a Sketch library.',
   'design-systems', null, 'CC-BY-NC-4.0', 12),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000006', 'pulse-fitness-tracker',
   'Pulse — Fitness Tracker', 'A fitness tracker app design with a Flutter-ready component set.',
   E'Pulse covers onboarding, daily rings, workout logging and progress charts across 28 screens, with a component set that maps 1:1 to Flutter widgets.',
   'cross-platform', null, 'MIT', 8);

insert into public.templates (id, owner_id, slug, title, tagline, description, category_id, status, demo_url, published_at, created_at)
select t.id, t.owner, t.slug, t.title, t.tagline, t.description, c.id, 'published', t.demo,
       now() - make_interval(days => t.published_days), now() - make_interval(days => t.published_days + 2)
from seed_t t join public.categories c on c.slug = t.cat;

insert into public.template_versions (id, template_id, owner_id, version, changelog, license_code, status, rights_attested_at, published_at, created_at)
select ('20000000-0000-4000-8000-00000000000' || right(t.id::text, 1))::uuid, t.id, t.owner, '1.0.0', 'First release.',
       t.license, 'published', now() - make_interval(days => t.published_days), now() - make_interval(days => t.published_days),
       now() - make_interval(days => t.published_days + 1)
from seed_t t;

-- Nocturne has a history: 1.0.0 → 1.1.0 → 1.2.0 (latest).
insert into public.template_versions (id, template_id, owner_id, version, changelog, license_code, status, rights_attested_at, published_at) values
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   '1.1.0', 'Light theme and 14 new components.', 'MIT', 'published', now() - interval '2 days', now() - interval '2 days'),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   '1.2.0', 'Added cohort table, fixed focus rings on date picker.', 'MIT', 'published', now() - interval '1 day', now() - interval '1 day');

update public.templates t set current_version_id = coalesce(
  (select v.id from public.template_versions v where v.template_id = t.id order by public.semver_key(v.version) desc limit 1), t.current_version_id);

-- Files point at the clean bucket. `npm run seed:storage` uploads small placeholder bytes to these paths.
insert into public.template_files (version_id, template_id, owner_id, bucket, storage_path, original_name, ext, size_bytes, sha256, source_tool, scan_status, scanned_at, manifest)
values
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   'template-files', 'seed/nocturne/dashboard-kit-v1.2.0.zip', 'dashboard-kit-v1.2.0.zip', 'zip', 14889779, repeat('a', 64), 'code', 'clean', now(),
   '{"entries":[{"path":"dashboard-kit/app/layout.tsx","size":2150},{"path":"dashboard-kit/app/page.tsx","size":6963},{"path":"dashboard-kit/components/charts/line-chart.tsx","size":3481},{"path":"dashboard-kit/tailwind.config.ts","size":1229},{"path":"dashboard-kit/README.md","size":4096}]}'),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   'template-files', 'seed/nocturne/dashboard-kit.fig', 'dashboard-kit.fig', 'fig', 39845888, repeat('b', 64), 'figma', 'clean', now(), null),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003',
   'template-files', 'seed/brutal-folio/brutal-folio.zip', 'brutal-folio.zip', 'zip', 2202009, repeat('c', 64), 'code', 'clean', now(),
   '{"entries":[{"path":"brutal-folio/src/pages/index.astro","size":5120},{"path":"brutal-folio/src/styles/global.css","size":3072},{"path":"brutal-folio/astro.config.mjs","size":412}]}'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005',
   'template-files', 'seed/glasshouse/glasshouse.psd', 'glasshouse.psd', 'psd', 88080384, repeat('d', 64), 'psd', 'clean', now(), null),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005',
   'template-files', 'seed/glasshouse/glasshouse.sketch', 'glasshouse.sketch', 'sketch', 31457280, repeat('e', 64), 'sketch', 'clean', now(), null);

insert into public.template_links (template_id, owner_id, kind, url) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'figma', 'https://www.figma.com/community/file/1000000000000000001/nocturne'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'figma', 'https://www.figma.com/community/file/1000000000000000002/tindahan'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', 'canva', 'https://www.canva.com/design/DAGledgerlite/view'),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000006', 'figma', 'https://www.figma.com/community/file/1000000000000000006/pulse');

insert into public.template_tags (template_id, tag_id, owner_id)
select t.id, g.id, t.owner_id from public.templates t
join (values
  ('nocturne-saas-dashboard-kit', '{nextjs,tailwind,typescript,figma,dark}'),
  ('tindahan-grocery-delivery-app', '{figma,ios,android,food}'),
  ('brutal-folio', '{astro,html-css,brutalist}'),
  ('ledger-lite-invoicing-concept', '{canva,fintech,minimal}'),
  ('glasshouse-ui-kit', '{photoshop,sketch,glass}'),
  ('pulse-fitness-tracker', '{figma,flutter,health}')
) as x (slug, tags) on x.slug = t.slug::text
join public.tags g on g.slug = any (x.tags::text[]);

-- ─────────────────────────────────────────────── engagement (real rows; triggers keep stats honest)
insert into public.likes (user_id, template_id)
select u.id, t.id from public.profiles u cross join public.templates t
where u.id <> t.owner_id and (hashtext(u.id::text || t.id::text) % 3) <> 0;

insert into public.votes (user_id, template_id, design, usability, creativity, code_quality)
select u.id, t.id,
       7 + abs(hashtext(u.id::text || t.id::text || 'd')) % 4,
       7 + abs(hashtext(u.id::text || t.id::text || 'u')) % 3,
       6 + abs(hashtext(u.id::text || t.id::text || 'c')) % 4,
       case when public.template_has_code(t.id) then 7 + abs(hashtext(u.id::text || t.id::text || 'q')) % 4 end
from public.profiles u cross join public.templates t
where u.id <> t.owner_id and t.slug <> 'ledger-lite-invoicing-concept';

insert into public.follows (follower_id, followee_id)
select a.id, b.id from public.profiles a cross join public.profiles b
where a.id <> b.id and b.trust_level >= 1 and (hashtext(a.id::text || b.id::text) % 2) = 0;

insert into public.comments (id, template_id, author_id, body, created_at) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
   'The chart tokens are so clean. Any plans for a cohort retention heatmap?', now() - interval '2 hours'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003',
   'Dropped the ZIP into a fresh Next app and it built first try. Rare.', now() - interval '5 hours');
insert into public.comments (template_id, author_id, parent_id, body, created_at) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   'Yes! It''s in the v1.3 branch, shipping next week.', now() - interval '1 hour');

insert into public.collections (id, owner_id, name, is_public) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', 'Dashboards', true),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000007', 'Client pitches', false);
insert into public.collection_items (collection_id, template_id, owner_id) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000007');

-- Downloads and views have no seed rows; give the demo realistic-looking totals.
update public.template_stats s set
  download_count = x.dl, view_count = x.views
from (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 1284, 48210),
  ('10000000-0000-4000-8000-000000000002'::uuid, 1036, 30512),
  ('10000000-0000-4000-8000-000000000003'::uuid, 702, 18204),
  ('10000000-0000-4000-8000-000000000004'::uuid, 146, 3920),
  ('10000000-0000-4000-8000-000000000005'::uuid, 860, 22410),
  ('10000000-0000-4000-8000-000000000006'::uuid, 1190, 28770)
) as x (id, dl, views)
where s.template_id = x.id;

-- ─────────────────────────────────────────────── awards
insert into public.awards (template_id, period, period_start, category_id, score_snapshot, vote_count_snapshot, blurb)
select '10000000-0000-4000-8000-000000000001', 'day', current_date - 1, null, 8.7, s.vote_count,
       'Voters called out the chart tokens and a ZIP that builds on the first try.'
from public.template_stats s where s.template_id = '10000000-0000-4000-8000-000000000001';
insert into public.awards (template_id, period, period_start, category_id, score_snapshot, vote_count_snapshot)
select '10000000-0000-4000-8000-000000000006', 'week', date_trunc('week', current_date)::date - 7,
       (select id from public.categories where slug = 'mobile-apps'), 8.3, s.vote_count
from public.template_stats s where s.template_id = '10000000-0000-4000-8000-000000000006';
insert into public.awards (template_id, period, period_start, category_id, score_snapshot, vote_count_snapshot)
select '10000000-0000-4000-8000-000000000005', 'month', (date_trunc('month', current_date) - interval '1 month')::date, null, 8.0, s.vote_count
from public.template_stats s where s.template_id = '10000000-0000-4000-8000-000000000005';

select public.refresh_hot_scores();
