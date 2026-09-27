'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { markNotificationsRead } from '@/app/actions/moderation';

export function MarkAllRead() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} className="btn btn-secondary"
            onClick={() => start(async () => { await markNotificationsRead(); router.refresh(); })}>
      Mark all read
    </button>
  );
}
