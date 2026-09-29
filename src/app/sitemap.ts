import type { MetadataRoute } from 'next';
import { publicClient } from '@/lib/supabase/clients';
import { publicEnv } from '@/lib/env';

// Public, indexable pages only. Private areas are also disallowed in robots.ts.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const db = publicClient(['sitemap'], 3600);
  const [templates, creators, categories] = await Promise.all([
    db.from('templates').select('slug, updated_at').eq('status', 'published').order('updated_at', { ascending: false }).limit(5000),
    db.from('creator_stats').select('username, created_at').gt('template_count', 0).limit(5000),
    db.from('categories').select('slug').order('sort'),
  ]);
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/explore`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/ranking`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${base}/community`, changeFrequency: 'daily', priority: 0.6 },
    { url: `${base}/categories`, changeFrequency: 'weekly', priority: 0.6 },
    ...['licenses', 'upload-guidelines', 'terms', 'privacy', 'dmca'].map((p) => ({ url: `${base}/legal/${p}`, changeFrequency: 'yearly' as const, priority: 0.2 })),
  ];
  return [
    ...staticPages,
    ...((categories.data ?? []) as { slug: string }[]).map((c) => ({ url: `${base}/c/${c.slug}`, changeFrequency: 'daily' as const, priority: 0.7 })),
    ...((templates.data ?? []) as { slug: string; updated_at: string }[]).map((t) => ({ url: `${base}/t/${t.slug}`, lastModified: t.updated_at, changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...((creators.data ?? []) as { username: string }[]).map((c) => ({ url: `${base}/@${c.username}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
  ];
}
