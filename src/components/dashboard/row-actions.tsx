'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { deleteDraft, setUnlisted } from '@/app/actions/upload';
import { useToast } from '../toast';
import type { TemplateStatus } from '@/lib/types';

/** Only the actions the server will actually accept for this status are shown. */
export function RowActions({ id, slug, status }: { id: string; slug: string; status: TemplateStatus }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast({ text: r.error ?? 'Something went wrong.', tone: 'error' });
    toast({ text: done, tone: 'ok' });
    router.refresh();
  });
  const btn = 'btn btn-ghost h-9 px-2.5 text-[13px]';
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {status === 'draft' && <>
        <Link href={`/upload/${id}?step=1`} className={btn}>Continue</Link>
        <button type="button" disabled={pending} className={`${btn} text-danger`}
                onClick={() => confirm('Delete this draft? This cannot be undone.') && run(() => deleteDraft(id), 'Draft deleted')}>Delete</button>
      </>}
      {status === 'pending_review' && <Link href={`/upload/${id}?step=1`} className={btn}>Edit details</Link>}
      {status === 'published' && <>
        <Link href={`/t/${slug}`} className={btn}>View</Link>
        <Link href={`/upload/${id}?step=1`} className={btn}>Edit</Link>
        <Link href={`/upload/${id}?step=2`} className={btn}>New version</Link>
        <button type="button" disabled={pending} className={btn} onClick={() => run(() => setUnlisted(id, true), 'Unlisted. Only people with the link can see it.')}>Unlist</button>
      </>}
      {status === 'unlisted' && <>
        <Link href={`/t/${slug}`} className={btn}>View</Link>
        <Link href={`/upload/${id}?step=1`} className={btn}>Edit</Link>
        <button type="button" disabled={pending} className={btn} onClick={() => run(() => setUnlisted(id, false), 'Listed again')}>Relist</button>
      </>}
      {status === 'removed' && <Link href={`/upload/${id}?step=1`} className={btn}>See reason</Link>}
    </div>
  );
}
