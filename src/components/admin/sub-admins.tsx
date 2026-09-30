'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setSubAdmin } from '@/app/actions/moderation';
import { setFollow } from '@/app/actions/engagement';
import { useToast } from '../toast';

/**
 * Make a friend a sub-admin, or take it away. Only friends qualify (they follow
 * you and you follow them back), so followers you don't follow get a Follow back
 * button first. set_sub_admin re-checks admin + friendship in Postgres.
 */
export function SubAdminToggle({ userId, on, isFriend }: { userId: string; on: boolean; isFriend: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (next: boolean) => start(async () => {
    const r = await setSubAdmin(userId, next);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    toast({ text: next ? 'Made a sub-admin.' : 'Sub-admin removed.', tone: 'ok' });
    router.refresh();
  });
  if (on) return <button type="button" disabled={pending} onClick={() => run(false)} className="btn btn-secondary h-9 px-3">Remove sub-admin</button>;
  if (!isFriend) {
    return (
      <button type="button" disabled={pending} className="btn btn-secondary h-9 px-3"
              onClick={() => start(async () => {
                const r = await setFollow(userId, true);
                if (!r.ok) return toast({ text: r.error, tone: 'error' });
                toast({ text: 'Followed back. You are friends now.', tone: 'ok' });
                router.refresh();
              })}>Follow back</button>
    );
  }
  return <button type="button" disabled={pending} onClick={() => run(true)} className="btn btn-primary h-9 px-3">Make sub-admin</button>;
}
