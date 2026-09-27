-- Reference data needed in every environment (production included).

insert into public.licenses (code, name, url, summary, allows_commercial, requires_attribution, sort) values
  ('MIT', 'MIT License', 'https://opensource.org/license/mit',
   'Use it for anything, including client and commercial work. Keep the copyright notice in your project.', true, true, 1),
  ('CC-BY-4.0', 'Creative Commons Attribution 4.0', 'https://creativecommons.org/licenses/by/4.0/',
   'Use and adapt it for anything, including commercial work, as long as you credit the creator.', true, true, 2),
  ('CC-BY-NC-4.0', 'Creative Commons Attribution-NonCommercial 4.0', 'https://creativecommons.org/licenses/by-nc/4.0/',
   'Use and adapt it for personal and non-commercial projects, with credit. No commercial use.', false, true, 3),
  ('PERSONAL', 'Personal use only', null,
   'For learning and personal projects only. No client work, no redistribution, no resale.', false, false, 4);

insert into public.categories (slug, name, kind, sort, description) values
  ('websites',      'Websites',      'web',       1, 'Landing pages, portfolios, stores and full sites.'),
  ('mobile-apps',   'Mobile Apps',   'mobile',    2, 'iOS, Android and cross-platform app designs.'),
  ('ui-kits',       'UI Kits',       'kit',       3, 'Component libraries and design systems, ready to fork.'),
  ('components',    'Components',    'component', 4, 'Navbars, heroes, pricing tables, forms and more.'),
  ('email',         'Email',         'other',     5, 'Transactional and marketing email templates.'),
  ('presentations', 'Presentations', 'other',     6, 'Pitch decks and presentation templates.'),
  ('concepts',      'Concepts',      'concept',   7, 'Web app ideas and explorations. No download required.');

insert into public.categories (slug, name, kind, sort, parent_id)
select v.slug, v.name, p.kind, v.sort, p.id
from (values
  ('websites', 'landing-pages', 'Landing pages', 1), ('websites', 'saas', 'SaaS', 2),
  ('websites', 'portfolios', 'Portfolios', 3), ('websites', 'agency', 'Agency', 4),
  ('websites', 'e-commerce', 'E-commerce', 5), ('websites', 'blogs', 'Blogs & editorial', 6),
  ('websites', 'dashboards', 'Dashboards & admin', 7), ('websites', 'docs', 'Docs', 8),
  ('websites', 'events', 'Events', 9), ('websites', 'restaurants', 'Restaurants', 10),
  ('websites', 'real-estate', 'Real estate', 11), ('websites', 'personal', 'Personal', 12),
  ('mobile-apps', 'ios', 'iOS', 1), ('mobile-apps', 'android', 'Android', 2),
  ('mobile-apps', 'cross-platform', 'Cross-platform', 3),
  ('ui-kits', 'component-libraries', 'Component libraries', 1), ('ui-kits', 'design-systems', 'Design systems', 2),
  ('ui-kits', 'icon-sets', 'Icon sets', 3), ('ui-kits', 'wireframe-kits', 'Wireframe kits', 4),
  ('components', 'navbars', 'Navbars', 1), ('components', 'heroes', 'Heroes', 2),
  ('components', 'pricing', 'Pricing', 3), ('components', 'forms', 'Forms', 4),
  ('components', 'footers', 'Footers', 5), ('components', 'cards', 'Cards', 6), ('components', 'charts', 'Charts', 7)
) as v (parent, slug, name, sort)
join public.categories p on p.slug = v.parent;

insert into public.tags (slug, name, type) values
  ('html-css', 'HTML/CSS', 'stack'), ('react', 'React', 'stack'), ('nextjs', 'Next.js', 'stack'),
  ('vue', 'Vue', 'stack'), ('svelte', 'Svelte', 'stack'), ('astro', 'Astro', 'stack'),
  ('tailwind', 'Tailwind', 'stack'), ('typescript', 'TypeScript', 'stack'), ('flutter', 'Flutter', 'stack'),
  ('swiftui', 'SwiftUI', 'stack'), ('react-native', 'React Native', 'stack'),
  ('webflow', 'Webflow', 'stack'), ('framer', 'Framer', 'stack'),
  ('ios', 'iOS', 'stack'), ('android', 'Android', 'stack'),
  ('figma', 'Figma', 'tool'), ('photoshop', 'Photoshop', 'tool'), ('canva', 'Canva', 'tool'),
  ('sketch', 'Sketch', 'tool'), ('illustrator', 'Illustrator', 'tool'), ('penpot', 'Penpot', 'tool'),
  ('minimal', 'Minimal', 'style'), ('brutalist', 'Brutalist', 'style'), ('glass', 'Glass', 'style'),
  ('editorial', 'Editorial', 'style'), ('playful', 'Playful', 'style'), ('corporate', 'Corporate', 'style'),
  ('dark', 'Dark', 'style'), ('retro', 'Retro', 'style'), ('3d', '3D', 'style'),
  ('fintech', 'Fintech', 'industry'), ('health', 'Health', 'industry'), ('food', 'Food', 'industry'),
  ('travel', 'Travel', 'industry'), ('productivity', 'Productivity', 'industry'), ('social', 'Social', 'industry');
