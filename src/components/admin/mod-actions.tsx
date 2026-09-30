'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { moderateTemplate, resolveReport } from '@/app/actions/moderation';
import { deletePost, removePostComment } from '@/app/actions/posts';
import { useToast } from '../toast';

export function TemplateModActions({ id, status, canRemove = true }: { id: string; status: string; canRemove?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const run = (action: 'approve' | 'reject' | 'remove' | 'restore') => start(async () => {
    const r = await moderateTemplate(id, action, reason);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    toast({ text: `Done: ${action}`, tone: 'ok' });
    setReason('');
    router.refresh();
  });
  return (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor={`reason-${id}`}>Reason (required to reject or remove)</label>
      <input id={`reason-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className="field h-9" placeholder={canRemove ? 'Reason (required to reject or remove)' : 'What should the creator change? (required to request changes)'} />
      <div className="flex flex-wrap gap-2">
        {status === 'pending_review' && <>
          <button type="button" disabled={pending} onClick={() => run('approve')} className="btn btn-primary h-9 px-3">Approve</button>
          <button type="button" disabled={pending || reason.trim().length < 3} onClick={() => run('reject')} className="btn btn-secondary h-9 px-3">Request changes</button>
        </>}
        {canRemove && status !== 'removed' && <button type="button" disabled={pending || reason.trim().length < 3} onClick={() => run('remove')} className="btn btn-danger h-9 px-3">Remove</button>}
        {canRemove && status === 'removed' && <button type="button" disabled={pending} onClick={() => run('restore')} className="btn btn-secondary h-9 px-3">Restore</button>}
      </div>
    </div>
  );
}

export function ReportActions({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const run = (status: 'resolved' | 'dismissed') => start(async () => {
    const r = await resolveReport(id, status, note);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    router.refresh();
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} aria-label="Resolution note" className="field h-9 max-w-xs" placeholder="Note" />
      <button type="button" disabled={pending} onClick={() => run('resolved')} className="btn btn-secondary h-9 px-3">Resolved</button>
      <button type="button" disabled={pending} onClick={() => run('dismissed')} className="btn btn-ghost h-9 px-3">Dismiss</button>
    </div>
  );
}

/** Remove a reported post or post comment (the reason is required and goes in the audit log). */
export function PostRemoveAction({ id, kind = 'post' }: { id: string; kind?: 'post' | 'comment' }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label={`Reason for removing the ${kind}`} className="field h-9 max-w-xs" placeholder="Reason (required)" />
      <button type="button" disabled={pending || reason.trim().length < 3} className="btn btn-danger h-9 px-3"
              onClick={() => start(async () => {
                const r = await (kind === 'post' ? deletePost(id, reason) : removePostComment(id, reason));
                if (!r.ok) return toast({ text: r.error, tone: 'error' });
                toast({ text: kind === 'post' ? 'Post removed.' : 'Comment removed.', tone: 'ok' });
                router.refresh();
              })}>{kind === 'post' ? 'Remove post' : 'Remove comment'}</button>
    </div>
  );
}
