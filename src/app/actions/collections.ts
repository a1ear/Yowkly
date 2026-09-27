'use server';
import { z } from 'zod';
import { authed, fail, toUserError, type ActionResult } from '@/lib/actions';

const uuid = z.uuid();

export async function createCollection(name: string, isPublic: boolean): Promise<ActionResult<{ id: string }>> {
  const parsed = z.string().trim().min(1, 'Name your collection.').max(60, 'Keep the name under 60 characters.').safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const a = await authed('write');
  if ('error' in a) return a.error;
  const res = await a.db.from('collections').insert({ name: parsed.data, is_public: isPublic }).select('id').single();
  if (res.error) return fail(toUserError(res.error));
  return { ok: true, data: { id: res.data.id } };
}

export async function setInCollection(collectionId: string, templateId: string, saved: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(collectionId).success || !uuid.safeParse(templateId).success) return fail('Invalid request.');
  const a = await authed('write');
  if ('error' in a) return a.error;
  const res = saved
    ? await a.db.from('collection_items').upsert({ collection_id: collectionId, template_id: templateId },
        { onConflict: 'collection_id,template_id', ignoreDuplicates: true })
    : await a.db.from('collection_items').delete().eq('collection_id', collectionId).eq('template_id', templateId);
  if (res.error) return fail(toUserError(res.error));
  return { ok: true, data: null };
}
