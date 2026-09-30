'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setSubAdmin } from '@/app/actions/moderation';
import { useToast } from '../toast';

/** Make a follower a sub-admin, or take it away. set_sub_admin re-checks admin + follower in Postgres. */
export function SubAdminToggle({ userId, on, canGrant }: { userId: string; on: boolean; canGrant: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (next: boolean) => start(async () => {
    const r = await setSubAdmin(userId, next);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    toast({ text: next ? 'Made a sub-admin.' : 'Sub-admin removed.', tone: 'ok' });
    router.refresh();
  });
  return on
    ? <button type="button" disabled={pending} onClick={() => run(false)} className="btn btn-secondary h-9 px-3">Remove sub-admin</button>
    : <button type="button" disabled={pending || !canGrant} onClick={() => run(true)} className="btn btn-primary h-9 px-3">Make sub-admin</button>;
}
