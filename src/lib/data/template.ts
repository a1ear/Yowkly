import 'server-only';
import { publicClient } from '@/lib/supabase/clients';
import type { LinkKind, ScanStatus, TemplateCard, Tool } from '@/lib/types';

export type TemplateFile = {
  id: string; version_id: string; original_name: string; ext: string; size_bytes: number;
  source_tool: Tool; scan_status: ScanStatus; manifest: { entries?: { path: string; size: number }[] } | null;
};
export type TemplateVersion = {
  id: string; version: string; changelog: string | null; license_code: string | null;
  status: 'draft' | 'published' | 'yanked'; yank_reason: string | null; published_at: string | null;
};
export type TemplateComment = {
  id: string; parent_id: string | null; body: string; created_at: string; updated_at: string; deleted_at: string | null;
  author: { id: string; username: string; display_name: string; avatar_path: string | null } | null;
};
export type TemplateMedia = { id: string; path: string; kind: 'cover' | 'gallery' | 'mobile_screen'; device: string; alt_text: string; sort: number };

export const templateTag = (id: string) => `template:${id}`;

export async function getTemplateDetail(slug: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 90) return null;

  // The slug lookup is tagged by slug; everything else by id so actions can revalidate it.
  const head = await publicClient(['templates', `slug:${slug}`])
    .from('template_cards').select('*').eq('slug', slug).in('status', ['published', 'unlisted']).maybeSingle();
  if (head.error) throw new Error(`Failed to load template: ${head.error.message}`);
  const card = head.data as TemplateCard | null;
  if (!card) return null;

  const db = publicClient(['templates', templateTag(card.id)]);
  const [tpl, versions, files, links, media, comments, license, stats] = await Promise.all([
    db.from('templates').select('description, demo_url, current_version_id').eq('id', card.id).single(),
    db.from('template_versions').select('id, version, changelog, license_code, status, yank_reason, published_at')
      .eq('template_id', card.id).neq('status', 'draft').order('published_at', { ascending: false }),
    db.from('template_files').select('id, version_id, original_name, ext, size_bytes, source_tool, scan_status, manifest')
      .eq('template_id', card.id).eq('scan_status', 'clean').order('created_at'),
    db.from('template_links').select('kind').eq('template_id', card.id),
    db.from('template_media').select('id, path, kind, device, alt_text, sort').eq('template_id', card.id).order('sort'),
    db.from('comments')
      .select('id, parent_id, body, created_at, updated_at, deleted_at, author:profiles(id, username, display_name, avatar_path)')
      .eq('template_id', card.id).order('created_at', { ascending: true }).limit(200),
    card.license_code
      ? db.from('licenses').select('code, name, url, summary, allows_commercial, requires_attribution').eq('code', card.license_code).single()
      : Promise.resolve({ data: null, error: null }),
    db.from('template_stats').select('vote_count').eq('template_id', card.id).single(),
  ]);
  for (const r of [tpl, versions, files, links, media, comments, license, stats]) {
    if (r.error) throw new Error(`Failed to load template details: ${r.error.message}`);
  }

  return {
    card,
    description: (tpl.data as { description: string | null }).description,
    demoUrl: (tpl.data as { demo_url: string | null }).demo_url,
    currentVersionId: (tpl.data as { current_version_id: string | null }).current_version_id,
    versions: versions.data as TemplateVersion[],
    files: files.data as TemplateFile[],
    links: (links.data as { kind: LinkKind }[]).map((l) => l.kind),
    media: media.data as TemplateMedia[],
    comments: comments.data as unknown as TemplateComment[],
    license: license.data as { code: string; name: string; url: string | null; summary: string; allows_commercial: boolean; requires_attribution: boolean } | null,
    voteCount: (stats.data as { vote_count: number }).vote_count,
  };
}

export async function getRelated(card: TemplateCard) {
  const db = publicClient(['templates']);
  const [more, similar] = await Promise.all([
    db.from('template_cards').select('*').eq('status', 'published').eq('owner_id', card.owner_id).neq('id', card.id)
      .order('published_at', { ascending: false }).limit(4),
    db.from('template_cards').select('*').eq('status', 'published').neq('id', card.id).neq('owner_id', card.owner_id)
      .or(`category_slug.eq.${card.category_slug},parent_category_slug.eq.${card.parent_category_slug ?? card.category_slug}`)
      .order('hot_score', { ascending: false }).limit(4),
  ]);
  return {
    more: (more.data ?? []) as TemplateCard[],
    similar: (similar.data ?? []) as TemplateCard[],
  };
}
