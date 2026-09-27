'use server';
import { redirect } from 'next/navigation';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';
import { authed, toUserError } from '@/lib/actions';

export type FormState = { error?: string; ok?: boolean } | null;

const username = z.string().trim().regex(/^[A-Za-z0-9_]{3,30}$/, 'Usernames are 3–30 letters, numbers or underscores.');
const displayName = z.string().trim().min(1, 'Add your name.').max(60);

export async function completeOnboarding(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({
    username,
    displayName,
    categories: z.array(z.coerce.number().int().positive()).max(20),
    tags: z.array(z.coerce.number().int().positive()).max(30),
  }).safeParse({
    username: form.get('username'),
    displayName: form.get('displayName'),
    categories: form.getAll('category'),
    tags: form.getAll('tag'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.categories.length + parsed.data.tags.length < 3) return { error: 'Pick at least 3 interests.' };

  const a = await authed('write');
  if ('error' in a) return { error: a.error.error };
  const p = parsed.data;
  const upd = await a.db.from('profiles')
    .update({ username: p.username, display_name: p.displayName, onboarded_at: new Date().toISOString() })
    .eq('id', a.uid);
  if (upd.error) {
    return { error: upd.error.code === '23505' ? 'That username is taken.' : toUserError(upd.error) };
  }
  await a.db.from('user_interest_categories').delete().eq('user_id', a.uid);
  await a.db.from('user_interest_tags').delete().eq('user_id', a.uid);
  if (p.categories.length) await a.db.from('user_interest_categories').insert(p.categories.map((category_id) => ({ category_id })));
  if (p.tags.length) await a.db.from('user_interest_tags').insert(p.tags.map((tag_id) => ({ tag_id })));
  revalidateTag('creators', 'max');
  redirect('/for-you');
}

const https = z.string().trim().max(300).refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'Links must start with https://');

export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({
    username,
    displayName,
    bio: z.string().trim().max(500),
    location: z.string().trim().max(80),
    website: https,
    github: z.string().trim().regex(/^([A-Za-z0-9-]{1,39})?$/, 'GitHub usernames use letters, numbers and dashes.'),
    x: z.string().trim().transform((v) => v.replace(/^@/, '')).pipe(z.string().regex(/^([A-Za-z0-9_]{1,15})?$/, 'Invalid X handle.')),
    skills: z.string().trim().max(300),
    hire: z.boolean(),
    hideLikes: z.boolean(),
  }).safeParse({
    username: form.get('username'), displayName: form.get('displayName'), bio: form.get('bio') ?? '',
    location: form.get('location') ?? '', website: form.get('website') ?? '', github: form.get('github') ?? '',
    x: form.get('x') ?? '', skills: form.get('skills') ?? '', hire: form.get('hire') === 'on', hideLikes: form.get('hideLikes') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const a = await authed('write');
  if ('error' in a) return { error: a.error.error };
  const p = parsed.data;
  const skills = [...new Set(p.skills.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 15).map((s) => s.slice(0, 30));
  const { error } = await a.db.from('profiles').update({
    username: p.username, display_name: p.displayName, bio: p.bio || null, location: p.location || null,
    website: p.website || null, github: p.github || null, x_handle: p.x || null, skills,
    available_for_hire: p.hire, hide_likes: p.hideLikes,
  }).eq('id', a.uid);
  if (error) return { error: error.code === '23505' ? 'That username is taken.' : toUserError(error) };
  revalidateTag('creators', 'max');
  revalidateTag(`creator:${p.username.toLowerCase()}`, 'max');
  return { ok: true };
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
