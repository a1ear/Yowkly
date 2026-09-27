'use server';
import { redirect } from 'next/navigation';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { deleteObjects, presignUpload } from '@/lib/r2';
import { templateTag } from '@/lib/data/template';
import { publicEnv } from '@/lib/env';

export type WizardState = { error?: string; ok?: boolean } | null;
const uuid = z.uuid();

// ── Step 1: basics ────────────────────────────────────────────────────
const basics = z.object({
  title: z.string().trim().min(3, 'Titles need at least 3 characters.').max(80, 'Keep the title under 80 characters.'),
  tagline: z.string().trim().max(140, 'Keep the tagline under 140 characters.'),
  description: z.string().trim().max(10000, 'The description is too long (10,000 characters max).'),
  categoryId: z.coerce.number().int().positive('Choose a category.'),
  tagIds: z.array(z.coerce.number().int().positive()).max(10, 'Use at most 10 tags.'),
});

export async function saveBasics(templateId: string | null, _: WizardState, form: FormData): Promise<WizardState> {
  const parsed = basics.safeParse({
    title: form.get('title'), tagline: form.get('tagline') ?? '', description: form.get('description') ?? '',
    categoryId: form.get('subcategory') || form.get('category'), tagIds: form.getAll('tag'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const a = await authed('upload');
  if ('error' in a) return { error: a.error.error };
  const b = parsed.data;

  let id = templateId;
  if (!id) {
    const { data, error } = await a.db.rpc('create_template', { p_title: b.title, p_category_id: b.categoryId });
    if (error) return { error: toUserError(error) };
    id = (data as { template_id: string }[])[0].template_id;
  } else if (!uuid.safeParse(id).success) {
    return { error: 'Invalid template.' };
  }
  const upd = await a.db.from('templates')
    .update({ title: b.title, tagline: b.tagline || null, description: b.description || null, category_id: b.categoryId })
    .eq('id', id).select('id');
  if (upd.error) return { error: toUserError(upd.error) };
  if (!upd.data?.length) return { error: 'Template not found.' };
  const tags = await a.db.rpc('set_template_tags', { p_template: id, p_tag_ids: b.tagIds });
  if (tags.error) return { error: toUserError(tags.error) };
  revalidateTag(templateTag(id), 'max');
  redirect(`/upload/${id}?step=2`);
}

// ── Step 2: files and links ───────────────────────────────────────────
const LINK_HOSTS: Record<string, RegExp> = {
  github: /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/,
  figma: /^https:\/\/(www\.)?figma\.com\/(file|design|proto|community\/file)\/\S+$/,
  canva: /^https:\/\/(www\.)?canva\.com\/design\/\S+$/,
  framer: /^https:\/\/(www\.)?framer\.com\/(projects|remix|marketplace)\/\S+$/,
  webflow: /^https:\/\/(www\.)?webflow\.com\/made-in-webflow\/website\/\S+$/,
  penpot: /^https:\/\/design\.penpot\.app\/\S+$/,
};

/** Demo URLs are framed on our pages, so they must never point back at us or at Supabase. */
function demoAllowed(url: string) {
  try {
    const u = new URL(url);
    const own = [new URL(publicEnv.NEXT_PUBLIC_SITE_URL).hostname, new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).hostname];
    const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?)/.test(u.hostname);
    return u.protocol === 'https:' && !u.username && !own.includes(u.hostname) && !privateHost && url.length <= 500;
  } catch {
    return false;
  }
}

export async function saveLinks(templateId: string, _: WizardState, form: FormData): Promise<WizardState> {
  if (!uuid.safeParse(templateId).success) return { error: 'Invalid template.' };
  const demo = String(form.get('demo') ?? '').trim();
  if (demo && !demoAllowed(demo)) return { error: 'The demo URL must be a public https:// address.' };
  const links: { kind: string; url: string }[] = [];
  for (const kind of Object.keys(LINK_HOSTS)) {
    const url = String(form.get(`link_${kind}`) ?? '').trim();
    if (!url) continue;
    if (!LINK_HOSTS[kind].test(url)) return { error: `That doesn't look like a ${kind[0].toUpperCase() + kind.slice(1)} link.` };
    links.push({ kind, url });
  }
  const a = await authed('upload');
  if ('error' in a) return { error: a.error.error };
  const upd = await a.db.from('templates').update({ demo_url: demo || null }).eq('id', templateId).select('id');
  if (upd.error) return { error: toUserError(upd.error) };
  if (!upd.data?.length) return { error: 'Template not found.' };
  const del = await a.db.from('template_links').delete().eq('template_id', templateId);
  if (del.error) return { error: toUserError(del.error) };
  if (links.length) {
    const ins = await a.db.from('template_links').insert(links.map((l) => ({ template_id: templateId, ...l })));
    if (ins.error) return { error: toUserError(ins.error) };
  }
  redirect(`/upload/${templateId}?step=3`);
}

/** Step 1 of an upload: Postgres approves (owner, draft, type, size, count, quota) and picks the path. */
export async function startFileUpload(versionId: string, fileName: string, size: number): Promise<ActionResult<{ path: string; url: string }>> {
  if (!uuid.safeParse(versionId).success || typeof fileName !== 'string' || fileName.length > 200 || !Number.isInteger(size)) return fail('Invalid upload.');
  const a = await authed('upload');
  if ('error' in a) return a.error;
  const { data: path, error } = await a.db.rpc('prepare_file_upload', { p_version: versionId, p_filename: fileName, p_size: size });
  if (error) return fail(toUserError(error));
  try {
    const url = await presignUpload('quarantine', path as string, { contentType: 'application/octet-stream', size });
    return { ok: true, data: { path: path as string, url } };
  } catch (e) {
    console.error('[upload] presign failed', (e as Error).message);
    return fail('Uploads are temporarily unavailable. Try again shortly.');
  }
}

/** Step 2: record the finished upload. The scan worker verifies the real bytes before anything is public. */
export async function registerUpload(versionId: string, path: string, originalName: string, size: number): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(versionId).success || path.length > 300 || originalName.length > 200 || !Number.isInteger(size)) return fail('Invalid upload.');
  const a = await authed('upload');
  if ('error' in a) return a.error;
  const { data, error } = await a.db.rpc('register_file', { p_version: versionId, p_path: path, p_original_name: originalName, p_size: size });
  if (error) return fail(toUserError(error));
  return { ok: true, data: { id: data as string } };
}

export async function removeFile(fileId: string): Promise<ActionResult> {
  if (!uuid.safeParse(fileId).success) return fail('Invalid file.');
  const a = await authed('upload');
  if ('error' in a) return a.error;
  // Postgres checks ownership and draft status, deletes the row and hands back the key.
  const { data, error } = await a.db.rpc('delete_draft_file', { p_file: fileId });
  if (error) return fail(toUserError(error));
  await deleteObjects((data ?? []) as { bucket: string; storage_path: string }[]);
  return { ok: true, data: null };
}

// ── Step 3: media ─────────────────────────────────────────────────────
const media = z.object({
  templateId: uuid,
  path: z.string().max(300),
  kind: z.enum(['cover', 'gallery', 'mobile_screen']),
  device: z.enum(['desktop', 'tablet', 'mobile']),
  alt: z.string().trim().min(3, 'Describe the image in a few words (alt text).').max(250),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(20000),
});

export async function startMediaUpload(templateId: string, contentType: string, size: number): Promise<ActionResult<{ path: string; url: string }>> {
  if (!uuid.safeParse(templateId).success || !Number.isInteger(size) || typeof contentType !== 'string') return fail('Invalid image.');
  const a = await authed('upload');
  if ('error' in a) return a.error;
  const { data: path, error } = await a.db.rpc('prepare_media_upload', { p_template: templateId, p_content_type: contentType, p_size: size });
  if (error) return fail(toUserError(error));
  try {
    const url = await presignUpload('media', path as string, { contentType, size });
    return { ok: true, data: { path: path as string, url } };
  } catch (e) {
    console.error('[upload] presign failed', (e as Error).message);
    return fail('Uploads are temporarily unavailable. Try again shortly.');
  }
}

export async function registerMedia(input: z.input<typeof media>): Promise<ActionResult<{ id: string }>> {
  const parsed = media.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const m = parsed.data;
  const a = await authed('upload');
  if ('error' in a) return a.error;
  const { data, error } = await a.db.rpc('register_media', {
    p_template: m.templateId, p_path: m.path, p_kind: m.kind, p_device: m.device, p_alt: m.alt, p_width: m.width, p_height: m.height,
  });
  if (error) return fail(toUserError(error));
  revalidateTag(templateTag(m.templateId), 'max');
  return { ok: true, data: { id: data as string } };
}

export async function updateMediaAlt(mediaId: string, alt: string): Promise<ActionResult> {
  const parsed = z.string().trim().min(3, 'Alt text needs at least 3 characters.').max(250).safeParse(alt);
  if (!parsed.success || !uuid.safeParse(mediaId).success) return fail(parsed.error?.issues[0].message ?? 'Invalid image.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const res = await a.db.from('template_media').update({ alt_text: parsed.data }).eq('id', mediaId).select('id');
  if (res.error) return fail(toUserError(res.error));
  return res.data?.length ? { ok: true, data: null } : fail('Image not found.');
}

export async function removeMedia(mediaId: string): Promise<ActionResult> {
  if (!uuid.safeParse(mediaId).success) return fail('Invalid image.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const res = await a.db.from('template_media').delete().eq('id', mediaId).select('path');
  if (res.error) return fail(toUserError(res.error));
  if (!res.data?.length) return fail('Image not found.');
  await deleteObjects([{ bucket: 'media', storage_path: res.data[0].path as string }]);
  return { ok: true, data: null };
}

// ── Step 4: license and version ───────────────────────────────────────
export async function saveLicense(templateId: string, versionId: string, _: WizardState, form: FormData): Promise<WizardState> {
  const parsed = z.object({
    license: z.enum(['MIT', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'PERSONAL'], { message: 'Choose a license.' }),
    version: z.string().trim().regex(/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/, 'Use semantic versioning, e.g. 1.2.0'),
    changelog: z.string().trim().max(5000),
  }).safeParse({ license: form.get('license'), version: form.get('version'), changelog: form.get('changelog') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!uuid.safeParse(versionId).success || !uuid.safeParse(templateId).success) return { error: 'Invalid version.' };
  const a = await authed('write');
  if ('error' in a) return { error: a.error.error };
  const res = await a.db.from('template_versions')
    .update({ license_code: parsed.data.license, version: parsed.data.version, changelog: parsed.data.changelog || null })
    .eq('id', versionId).select('id');
  if (res.error) return { error: res.error.code === '23505' ? 'That version number already exists.' : toUserError(res.error) };
  if (!res.data?.length) return { error: 'This version is already published.' };
  redirect(`/upload/${templateId}?step=5`);
}

// ── Step 5: publish ───────────────────────────────────────────────────
export async function publishVersion(templateId: string, versionId: string, _: WizardState, form: FormData): Promise<WizardState> {
  if (!uuid.safeParse(versionId).success || !uuid.safeParse(templateId).success) return { error: 'Invalid version.' };
  if (form.get('attest') !== 'on') return { error: 'Confirm that you own the rights to this work.' };
  const a = await authed('upload');
  if ('error' in a) return { error: a.error.error };
  const { data, error } = await a.db.rpc('publish_version', { p_version: versionId, p_attest: true });
  if (error) return { error: toUserError(error) };
  revalidateTag('templates', 'max');
  revalidateTag('creators', 'max');
  revalidateTag(templateTag(templateId), 'max');
  redirect(`/dashboard?published=${data === 'pending_review' ? 'review' : 'live'}`);
}

// ── Dashboard lifecycle ───────────────────────────────────────────────
export async function setUnlisted(templateId: string, unlisted: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(templateId).success) return fail('Invalid template.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('set_template_unlisted', { p_template: templateId, p_unlisted: unlisted });
  if (error) return fail(toUserError(error));
  revalidateTag('templates', 'max');
  revalidateTag(templateTag(templateId), 'max');
  return { ok: true, data: null };
}

export async function startNewVersion(templateId: string, version: string): Promise<ActionResult> {
  if (!uuid.safeParse(templateId).success || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) return fail('Use semantic versioning, e.g. 1.3.0');
  const a = await authed('upload');
  if ('error' in a) return a.error;
  const { error } = await a.db.rpc('create_version', { p_template: templateId, p_version: version });
  if (error) return fail(toUserError(error));
  return { ok: true, data: null };
}

export async function deleteDraft(templateId: string): Promise<ActionResult> {
  if (!uuid.safeParse(templateId).success) return fail('Invalid template.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const { data, error } = await a.db.rpc('delete_draft_template', { p_template: templateId });
  if (error) return fail(toUserError(error));
  await deleteObjects((data ?? []) as { bucket: string; storage_path: string }[]);
  return { ok: true, data: null };
}
