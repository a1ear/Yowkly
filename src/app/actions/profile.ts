'use server';
import { redirect } from 'next/navigation';
import { revalidateTag, updateTag } from 'next/cache';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';
import { SOCIALS, parseHandle } from '@/lib/social';

export type FormState = { error?: string; ok?: boolean } | null;

const username = z.string().trim().regex(/^[A-Za-z0-9_]{3,30}$/, 'Usernames are 3–30 letters, numbers or underscores.');
const displayName = z.string().trim().min(1, 'Add your name.').max(60);

const interestsSchema = z.object({
  categories: z.array(z.coerce.number().int().positive()).max(20),
  tags: z.array(z.coerce.number().int().positive()).max(30),
});

/** Replace the signed-in user's interests (at least 3 picks in total). RLS scopes every row to them. */
async function saveInterests(form: FormData): Promise<FormState> {
  const parsed = interestsSchema.safeParse({ categories: form.getAll('category'), tags: form.getAll('tag') });
  if (!parsed.success) return { error: 'Those interests look invalid. Reload and try again.' };
  const { categories, tags } = parsed.data;
  if (categories.length + tags.length < 3) return { error: 'Pick at least 3 interests.' };
  const a = await authed('write');
  if ('error' in a) return { error: a.error.error };
  const steps = [
    await a.db.from('user_interest_categories').delete().eq('user_id', a.uid),
    await a.db.from('user_interest_tags').delete().eq('user_id', a.uid),
    categories.length ? await a.db.from('user_interest_categories').insert(categories.map((category_id) => ({ category_id }))) : null,
    tags.length ? await a.db.from('user_interest_tags').insert(tags.map((tag_id) => ({ tag_id }))) : null,
  ];
  const failed = steps.find((r) => r?.error);
  if (failed?.error) return { error: toUserError(failed.error) };
  return { ok: true };
}

/** First-run: save interests, mark onboarding done, go to the feed. Name and username are edited in Settings. */
export async function completeOnboarding(_: FormState, form: FormData): Promise<FormState> {
  const res = await saveInterests(form);
  if (!res?.ok) return res;
  const a = await authed('write');
  if ('error' in a) return { error: a.error.error };
  const upd = await a.db.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('id', a.uid).is('onboarded_at', null);
  if (upd.error) return { error: toUserError(upd.error) };
  redirect('/for-you');
}

/** Settings: change interests any time. */
export async function updateInterests(_: FormState, form: FormData): Promise<FormState> {
  return saveInterests(form);
}

const https = z.string().trim().max(300).refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'Links must start with https://');

export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({
    username,
    displayName,
    bio: z.string().trim().max(500),
    location: z.string().trim().max(80),
    website: https,
    skills: z.string().trim().max(300),
    hire: z.boolean(),
    hideLikes: z.boolean(),
  }).safeParse({
    username: form.get('username'), displayName: form.get('displayName'), bio: form.get('bio') ?? '',
    location: form.get('location') ?? '', website: form.get('website') ?? '', skills: form.get('skills') ?? '', hire: form.get('hire') === 'on', hideLikes: form.get('hideLikes') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // Links: accept a pasted URL or @handle, store only the handle.
  const links: Record<string, string | null> = {};
  for (const social of SOCIALS) {
    const handle = parseHandle(social, String(form.get(social.key) ?? ''));
    if (handle === undefined) return { error: `That doesn't look like a ${social.label} ${social.key === 'linkedin' ? 'profile link' : 'username'}.` };
    links[social.key] = handle;
  }
  const a = await authed('write');
  if ('error' in a) return { error: a.error.error };
  const p = parsed.data;
  const skills = [...new Set(p.skills.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 15).map((s) => s.slice(0, 30));
  const { error } = await a.db.from('profiles').update({
    username: p.username, display_name: p.displayName, bio: p.bio || null, location: p.location || null,
    website: p.website || null, ...links, skills,
    available_for_hire: p.hire, hide_likes: p.hideLikes,
  }).eq('id', a.uid);
  if (error) return { error: error.code === '23505' ? 'That username is taken.' : toUserError(error) };
  revalidateTag('creators', 'max');
  updateTag(`creator:${p.username.toLowerCase()}`); // the owner sees their edits on the next load
  return { ok: true };
}

/**
 * Point the profile at a newly uploaded avatar or cover photo (or clear it).
 * The browser uploads the resized image into the user's own folder in the
 * public "avatars" bucket (storage policy); the path is re-checked here and by
 * the "profiles: update self" policy. The previous image is deleted.
 */
export async function setProfileImage(kind: 'avatar' | 'cover', path: string | null): Promise<ActionResult<null>> {
  if (kind !== 'avatar' && kind !== 'cover') return fail('Invalid image.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  if (path !== null && !new RegExp(`^${a.uid}/${kind}-[a-z0-9]{8,32}\\.(webp|jpg)$`).test(path)) return fail('Invalid image path.');
  const column = kind === 'avatar' ? 'avatar_path' : 'banner_path';
  const { data: before } = await a.db.from('profiles').select(`username, ${column}`).eq('id', a.uid).single();
  const { error } = await a.db.from('profiles').update({ [column]: path }).eq('id', a.uid);
  if (error) return fail(toUserError(error));
  const old = (before as Record<string, string | null> | null)?.[column];
  if (old && old !== path) {
    const rm = await a.db.storage.from('avatars').remove([old]);
    if (rm.error || !rm.data?.length) console.error('[profile] could not delete old image', old, rm.error?.message);
  }
  const username = (before as { username: string } | null)?.username;
  // Read-your-own-write: the owner reloads straight into the new picture.
  if (username) updateTag(`creator:${username.toLowerCase()}`);
  revalidateTag('creators', 'max');
  return { ok: true, data: null };
}

export async function deleteAccount(_: FormState, form: FormData): Promise<FormState> {
  if (form.get('confirm') !== 'DELETE') return { error: 'Type DELETE to confirm.' };
  const a = await authed('write');
  if ('error' in a) return { error: a.error.error };
  const { error } = await a.db.rpc('delete_my_account');
  if (error) return { error: toUserError(error) };
  await a.db.auth.signOut();
  revalidateTag('creators', 'max');
  revalidateTag('templates', 'max');
  redirect('/?account=deleted');
}
