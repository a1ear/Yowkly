import 'server-only';
import { userClient } from '@/lib/supabase/clients';
import type { LinkKind, ScanStatus, TemplateStatus, Tool } from '@/lib/types';

export type DraftFile = {
  id: string; original_name: string; ext: string; size_bytes: number; source_tool: Tool;
  scan_status: ScanStatus; reject_reason: string | null; created_at: string;
};
export type DraftMedia = { id: string; path: string; kind: 'cover' | 'gallery' | 'mobile_screen'; device: 'desktop' | 'tablet' | 'mobile'; alt_text: string; width: number | null; height: number | null; sort: number };

/** Everything the upload wizard needs, read as the owner (RLS returns nothing for anyone else). */
export async function getDraft(templateId: string) {
  if (!/^[0-9a-f-]{36}$/.test(templateId)) return null;
  const db = await userClient();
  const { data: claims } = await db.auth.getClaims();
  const uid = claims?.claims?.sub as string | undefined;
  if (!uid) return null;
  const { data: t } = await db.from('templates')
    .select('id, owner_id, slug, title, tagline, description, category_id, demo_url, status, status_reason, current_version_id')
    .eq('id', templateId).eq('owner_id', uid).maybeSingle();
  if (!t) return null;

  const [versions, tags, links, media] = await Promise.all([
    db.from('template_versions').select('id, version, changelog, license_code, status, published_at')
      .eq('template_id', templateId).order('created_at', { ascending: false }),
    db.from('template_tags').select('tag_id').eq('template_id', templateId),
    db.from('template_links').select('kind, url').eq('template_id', templateId),
    db.from('template_media').select('id, path, kind, device, alt_text, width, height, sort').eq('template_id', templateId).order('sort'),
  ]);
  const allVersions = (versions.data ?? []) as { id: string; version: string; changelog: string | null; license_code: string | null; status: string; published_at: string | null }[];
  const draft = allVersions.find((v) => v.status === 'draft') ?? null;
  const files = draft
    ? ((await db.from('template_files')
        .select('id, original_name, ext, size_bytes, source_tool, scan_status, reject_reason, created_at')
        .eq('version_id', draft.id).order('created_at')).data ?? []) as DraftFile[]
    : [];

  return {
    uid,
    template: t as {
      id: string; owner_id: string; slug: string; title: string; tagline: string | null; description: string | null;
      category_id: number | null; demo_url: string | null; status: TemplateStatus; status_reason: string | null; current_version_id: string | null;
    },
    draft,
    latestPublished: allVersions.find((v) => v.status === 'published') ?? null,
    tagIds: ((tags.data ?? []) as { tag_id: number }[]).map((r) => r.tag_id),
    links: (links.data ?? []) as { kind: LinkKind; url: string }[],
    media: (media.data ?? []) as DraftMedia[],
    files,
  };
}
