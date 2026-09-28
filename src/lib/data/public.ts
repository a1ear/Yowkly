import 'server-only';
import { z } from 'zod';
import { publicClient } from '@/lib/supabase/clients';
import type { Category, Creator, License, TemplateCard } from '@/lib/types';

// Every public read goes through the cookie-less, cached client. Tags let
// actions revalidate exactly what changed (see lib/cache-tags.ts).

// Without generated DB types supabase-js infers loose shapes; the view/table
// contracts are pinned in lib/types.ts and checked by the DB tests.
function unwrap<T>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Failed to load ${what}: ${res.error.message}`);
  return res.data as T;
}

export async function getCategories(): Promise<Category[]> {
  const db = publicClient(['categories'], 3600);
  const res = await db.from('categories').select('id, slug, name, description, parent_id, kind, sort').order('sort');
  return unwrap(res, 'categories');
}

export async function getLicenses(): Promise<License[]> {
  const db = publicClient(['licenses'], 3600);
  const res = await db.from('licenses').select('code, name, url, summary, allows_commercial, requires_attribution').order('sort');
  return unwrap(res, 'licenses');
}

export async function getTagsByType() {
  const db = publicClient(['tags'], 3600);
  const res = await db.from('tags').select('id, slug, name, type').order('name');
  return unwrap<{ id: number; slug: string; name: string; type: 'stack' | 'tool' | 'style' | 'industry' }[]>(res, 'tags');
}

const cards = (tags: string[] = ['templates']) =>
  publicClient(tags).from('template_cards').select('*').eq('status', 'published');

export async function getCardsByIds(ids: string[]): Promise<TemplateCard[]> {
  if (!ids.length) return [];
  const res = await cards().in('id', ids);
  const rows = unwrap<TemplateCard[]>(res, 'templates');
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is TemplateCard => Boolean(r));
}

export async function getHome() {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const db = publicClient(['templates', 'awards']);
  const [trending, fresh, mobile, todRes, creators] = await Promise.all([
    cards().order('hot_score', { ascending: false }).order('published_at', { ascending: false }).limit(8),
    cards().gte('published_at', weekAgo).order('published_at', { ascending: false }).limit(8),
    cards().eq('parent_category_slug', 'mobile-apps').order('vote_count', { ascending: false }).order('published_at', { ascending: false }).limit(3),
    db.from('awards').select('template_id, period_start').eq('period', 'day').is('category_id', null)
      .order('period_start', { ascending: false }).limit(1),
    publicClient(['creators']).from('creator_stats').select('*').gt('template_count', 0)
      .order('followers', { ascending: false }).limit(4),
  ]);
  const tod = unwrap<{ template_id: string; period_start: string }[]>(todRes, 'awards')[0];
  const [templateOfTheDay] = tod ? await getCardsByIds([tod.template_id]) : [];
  const trendingRows = unwrap<TemplateCard[]>(trending, 'trending');
  return {
    templateOfTheDay: templateOfTheDay ?? trendingRows[0] ?? null,
    trending: trendingRows,
    fresh: unwrap<TemplateCard[]>(fresh, 'fresh templates'),
    mobile: unwrap<TemplateCard[]>(mobile, 'mobile templates'),
    creators: unwrap<Creator[]>(creators, 'creators'),
  };
}

// ── Explore / search ────────────────────────────────────────────────
export const SORTS = { trending: 'Trending', newest: 'Newest', top: 'Top voted', downloads: 'Most downloaded' } as const;
export type Sort = keyof typeof SORTS;

const list = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).filter((s): s is string => typeof s === 'string');

export const exploreParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  category: z.string().regex(/^[a-z0-9-]+$/).max(40).optional().catch(undefined),
  tag: z.preprocess(list, z.array(z.string().regex(/^[a-z0-9.-]+$/).max(40)).max(10)).catch([]),
  tool: z.preprocess(list, z.array(z.enum(['code', 'figma', 'psd', 'canva', 'sketch', 'xd', 'ai', 'penpot', 'pdf', 'github', 'framer', 'webflow'])).max(12)).catch([]),
  commercial: z.enum(['1']).optional().catch(undefined),
  sort: z.enum(['trending', 'newest', 'top', 'downloads']).catch('trending'),
  page: z.coerce.number().int().min(1).max(50).catch(1),
});
export type ExploreParams = z.infer<typeof exploreParams>;

export const PAGE_SIZE = 24;

export async function exploreTemplates(p: ExploreParams) {
  let q = publicClient(['templates'])
    .from('template_cards')
    .select('*', { count: 'estimated' })
    .eq('status', 'published');
  if (p.category) q = q.or(`category_slug.eq.${p.category},parent_category_slug.eq.${p.category}`);
  if (p.tag.length) q = q.contains('tag_slugs', p.tag);
  if (p.tool.length) q = q.overlaps('tools', p.tool);
  if (p.commercial) q = q.eq('allows_commercial', true);
  if (p.q) q = q.textSearch('search_tsv', p.q, { type: 'websearch', config: 'english' });
  const order = {
    trending: ['hot_score', false],
    newest: ['published_at', false],
    top: ['vote_count', false],
    downloads: ['download_count', false],
  } as const;
  const [col, asc] = order[p.sort];
  q = q.order(col, { ascending: asc, nullsFirst: false }).order('published_at', { ascending: false });
  const from = (p.page - 1) * PAGE_SIZE;
  const res = await q.range(from, from + PAGE_SIZE - 1);
  const rows = unwrap<TemplateCard[]>(res, 'templates');
  return { rows, total: res.count ?? rows.length, hasMore: rows.length === PAGE_SIZE };
}

// ── Ranking ───────────────────────────────────────────────────────────
export type AwardRow = {
  id: string; template_id: string; period: 'day' | 'week' | 'month'; period_start: string;
  score_snapshot: number | null; vote_count_snapshot: number; period_votes: number | null;
  blurb: string | null; category: { name: string } | null; template: TemplateCard;
};

/** Past winners (Template of the Day / Week / Month), newest first. */
export async function getAwards(): Promise<AwardRow[]> {
  const db = publicClient(['awards']);
  const res = await db.from('awards')
    .select('id, template_id, period, period_start, score_snapshot, vote_count_snapshot, period_votes, blurb, category:categories(name)')
    .order('period_start', { ascending: false }).limit(60);
  const awards = unwrap<Omit<AwardRow, 'template'>[]>(res, 'awards');
  const cardsById = new Map((await getCardsByIds([...new Set(awards.map((a) => a.template_id))])).map((c) => [c.id, c]));
  return awards
    .map((a) => ({ ...a, template: cardsById.get(a.template_id) }))
    .filter((a): a is AwardRow => Boolean(a.template));
}

async function getCreatorsByIds(ids: string[]): Promise<Creator[]> {
  if (!ids.length) return [];
  const res = await publicClient(['creators']).from('creator_stats').select('*').in('id', ids);
  const rows = unwrap<Creator[]>(res, 'creators');
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is Creator => Boolean(r));
}

/** Live standings for this week (votes so far) plus past Dev of the Week winners. */
export async function getRanking() {
  const db = publicClient(['awards', 'ranking'], 60);
  const [awards, devRes, weekRes, devLiveRes] = await Promise.all([
    getAwards(),
    db.from('dev_awards').select('id, user_id, week_start, vote_count, template_count').order('week_start', { ascending: false }).limit(12),
    db.rpc('ranking_templates', { p_period: 'week', p_limit: 10 }),
    db.rpc('ranking_devs', { p_limit: 5 }),
  ]);
  const devAwards = unwrap<{ id: string; user_id: string; week_start: string; vote_count: number; template_count: number }[]>(devRes, 'dev awards');
  const week = unwrap<{ template_id: string; votes: number }[]>(weekRes, 'weekly ranking');
  const devLive = unwrap<{ user_id: string; votes: number; templates: number }[]>(devLiveRes, 'dev ranking');
  const [weekCards, creators] = await Promise.all([
    getCardsByIds(week.map((w) => w.template_id)),
    getCreatorsByIds([...new Set([...devAwards.map((d) => d.user_id), ...devLive.map((d) => d.user_id)])]),
  ]);
  const cardById = new Map(weekCards.map((c) => [c.id, c]));
  const creatorById = new Map(creators.map((c) => [c.id, c]));
  return {
    awards,
    weekTemplates: week.flatMap((w) => (cardById.has(w.template_id) ? [{ votes: w.votes, template: cardById.get(w.template_id)! }] : [])),
    weekDevs: devLive.flatMap((d) => (creatorById.has(d.user_id) ? [{ ...d, creator: creatorById.get(d.user_id)! }] : [])),
    devAwards: devAwards.flatMap((d) => (creatorById.has(d.user_id) ? [{ ...d, creator: creatorById.get(d.user_id)! }] : [])),
  };
}

// ── Creators ──────────────────────────────────────────────────────────
export async function getCreator(username: string) {
  if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) return null;
  const res = await publicClient([`creator:${username.toLowerCase()}`, 'creators'])
    .from('creator_stats').select('*').ilike('username', username).maybeSingle();
  return unwrap<Creator | null>(res, 'creator');
}

export async function getCreatorTemplates(ownerId: string, limit = 24) {
  const res = await cards().eq('owner_id', ownerId).order('published_at', { ascending: false }).limit(limit);
  return unwrap<TemplateCard[]>(res, 'creator templates');
}
