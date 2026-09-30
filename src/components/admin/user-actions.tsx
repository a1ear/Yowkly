'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { adminSetModerator, adminSetTrust, adminSuspend } from '@/app/actions/moderation';
import { useToast } from '../toast';

/** Admin-only controls on a user row. Each one is re-checked by an admin_* function in Postgres and logged. */
export function UserAdminActions({ userId, isModerator, isAdmin, trusted, suspended }: {
  userId: string; isModerator: boolean; isAdmin: boolean; trusted: boolean; suspended: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast({ text: r.error ?? 'Something went wrong.', tone: 'error' });
    toast({ text: done, tone: 'ok' });
    setAsking(false); setReason('');
    router.refresh();
  });
  if (isAdmin) return <span className="text-[12px] text-ink-3">Admin</span>;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-1.5">
        <button type="button" disabled={pending} className="btn btn-secondary h-8 px-2.5 text-[12.5px]"
                onClick={() => run(() => adminSetModerator(userId, !isModerator), isModerator ? 'Moderator role removed.' : 'Made a moderator.')}>
          {isModerator ? 'Remove moderator' : 'Make moderator'}
        </button>
        <button type="button" disabled={pending} className="btn btn-secondary h-8 px-2.5 text-[12.5px]"
                title="Trusted creators publish without review"
                onClick={() => run(() => adminSetTrust(userId, !trusted), trusted ? 'Back to reviewed uploads.' : 'Uploads now skip review.')}>
          {trusted ? 'Untrust' : 'Trust creator'}
        </button>
        {suspended ? (
          <button type="button" disabled={pending} className="btn btn-secondary h-8 px-2.5 text-[12.5px]"
                  onClick={() => run(() => adminSuspend(userId, false), 'Suspension lifted.')}>Lift suspension</button>
        ) : (
          <button type="button" disabled={pending} onClick={() => setAsking((v) => !v)} className="btn btn-danger h-8 px-2.5 text-[12.5px]">Suspend</button>
        )}
      </div>
      {asking && (
        <div className="flex w-full max-w-sm gap-1.5">
          <label className="sr-only" htmlFor={`suspend-${userId}`}>Reason for suspending</label>
          <input id={`suspend-${userId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus
                 placeholder="Reason (shown in the audit log)" className="field h-8 text-[13px]" />
          <button type="button" disabled={pending || reason.trim().length < 3} className="btn btn-danger h-8 px-2.5 text-[12.5px]"
                  onClick={() => run(() => adminSuspend(userId, true, reason), 'Account suspended.')}>Confirm</button>
        </div>
      )}
    </div>
  );
}
