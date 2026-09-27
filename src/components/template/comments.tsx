'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Avatar } from '../bits';
import { useToast } from '../toast';
import { ReportDialog } from './panels';
import { postComment, editComment, deleteComment } from '@/app/actions/engagement';
import { useMe } from '../header-account';
import { timeAgo } from '@/lib/format';
import type { TemplateComment } from '@/lib/data/template';

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function Comments({ templateId, slug, ownerId, comments }: {
  templateId: string; slug: string; ownerId: string; comments: TemplateComment[];
}) {
  const me = useMe();
  const top = comments.filter((c) => !c.parent_id);
  const replies = (id: string) => comments.filter((c) => c.parent_id === id);
  return (
    <section aria-labelledby="comments-title" className="flex flex-col gap-5">
      <h2 id="comments-title" className="m-0 font-display text-[28px] font-normal">
        Comments <span className="font-mono text-base text-ink-3">{comments.filter((c) => !c.deleted_at).length}</span>
      </h2>
      {me === null && (
        <p className="m-0 text-ink-2"><Link href={`/auth/sign-in?next=/t/${slug}`} className="text-accent-ink underline underline-offset-4">Sign in</Link> to leave feedback.</p>
      )}
      {me && <Composer templateId={templateId} parentId={null} placeholder="Share feedback with the creator…" />}
      {top.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
          <p className="m-0 font-semibold">No comments yet</p>
          <p className="m-0 mt-1 text-ink-2">Be the first to tell the creator what you think.</p>
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-5 p-0">
          {top.map((c) => (
            <li key={c.id} className="flex flex-col gap-3">
              <CommentItem c={c} templateId={templateId} ownerId={ownerId} meId={me?.id} canReply />
              {replies(c.id).length > 0 && (
                <ol className="m-0 ml-10 flex list-none flex-col gap-3 border-l border-line p-0 pl-4">
                  {replies(c.id).map((r) => <li key={r.id}><CommentItem c={r} templateId={templateId} ownerId={ownerId} meId={me?.id} /></li>)}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CommentItem({ c, templateId, ownerId, meId, canReply }: {
  c: TemplateComment; templateId: string; ownerId: string; meId?: string; canReply?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<'view' | 'reply' | 'edit' | 'report'>('view');
  const [pending, start] = useTransition();
  const mine = meId && c.author?.id === meId;
  // eslint-disable-next-line react-hooks/purity -- the edit window is advisory; the database enforces it
  const editable = mine && Date.now() - new Date(c.created_at).getTime() < EDIT_WINDOW_MS;

  if (c.deleted_at) {
    return <p className="m-0 text-[13px] text-ink-3 italic">Comment deleted.</p>;
  }
  const name = c.author?.display_name ?? 'Deleted user';
  return (
    <article className="flex gap-3">
      <Avatar name={name} path={c.author?.avatar_path} seed={c.author?.username} size={32} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {c.author ? <Link href={`/@${c.author.username}`} className="font-semibold hover:text-accent-ink">{name}</Link> : <span className="font-semibold">{name}</span>}
          {c.author?.id === ownerId && <span className="rounded-xs bg-accent px-1.5 py-0.5 font-mono text-[10px] font-medium text-on-accent">CREATOR</span>}
          <span className="text-ink-3">{timeAgo(c.created_at)}{c.updated_at !== c.created_at ? ' · edited' : ''}</span>
        </div>
        {mode === 'edit' ? (
          <Composer templateId={templateId} parentId={null} initial={c.body} submitLabel="Save"
            onCancel={() => setMode('view')}
            onSubmit={async (body) => {
              const r = await editComment(c.id, templateId, body);
              if (!r.ok) toast({ text: r.error, tone: 'error' });
              else { setMode('view'); router.refresh(); }
              return r.ok;
            }} />
        ) : (
          <p className="m-0 whitespace-pre-wrap break-words text-ink-2">{c.body}</p>
        )}
        {meId && mode === 'view' && (
          <div className="flex gap-1">
            {canReply && <button type="button" onClick={() => setMode('reply')} className="btn btn-ghost h-8 px-2 text-[13px]">Reply</button>}
            {editable && <button type="button" onClick={() => setMode('edit')} className="btn btn-ghost h-8 px-2 text-[13px]">Edit</button>}
            {mine && (
              <button type="button" disabled={pending} className="btn btn-ghost h-8 px-2 text-[13px]" onClick={() => {
                if (!confirm('Delete this comment?')) return;
                start(async () => {
                  const r = await deleteComment(c.id, templateId);
                  if (!r.ok) toast({ text: r.error, tone: 'error' }); else router.refresh();
                });
              }}>Delete</button>
            )}
            {!mine && <button type="button" onClick={() => setMode('report')} className="btn btn-ghost h-8 px-2 text-[13px]">Report</button>}
          </div>
        )}
        {mode === 'reply' && <Composer templateId={templateId} parentId={c.id} placeholder={`Reply to ${name}…`} onCancel={() => setMode('view')} onDone={() => setMode('view')} />}
        {mode === 'report' && <ReportDialog targetType="comment" targetId={c.id} onClose={() => setMode('view')} />}
      </div>
    </article>
  );
}

function Composer({ templateId, parentId, placeholder, initial = '', submitLabel = 'Post comment', onCancel, onDone, onSubmit }: {
  templateId: string; parentId: string | null; placeholder?: string; initial?: string; submitLabel?: string;
  onCancel?: () => void; onDone?: () => void; onSubmit?: (body: string) => Promise<boolean>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        if (onSubmit) { await onSubmit(body); return; }
        const r = await postComment({ templateId, parentId, body });
        if (!r.ok) return toast({ text: r.error, tone: 'error' });
        setBody('');
        onDone?.();
        router.refresh();
      });
    }}>
      <label className="sr-only" htmlFor={`composer-${parentId ?? 'root'}`}>{placeholder ?? 'Comment'}</label>
      <textarea id={`composer-${parentId ?? 'root'}`} value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder}
                rows={parentId ? 2 : 3} maxLength={2000} className="field h-auto resize-y py-2.5" />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-ink-3">{body.length}/2000</span>
        <div className="flex gap-2">
          {onCancel && <button type="button" onClick={onCancel} className="btn btn-ghost h-10">Cancel</button>}
          <button type="submit" disabled={pending || !body.trim()} className="btn btn-primary h-10">{pending ? 'Posting…' : submitLabel}</button>
        </div>
      </div>
    </form>
  );
}
