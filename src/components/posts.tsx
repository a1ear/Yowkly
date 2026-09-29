'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { addPostComment, createPost, deletePost, loadPostComments, postReactionStates, removePostComment, setPostReaction } from '@/app/actions/posts';
import { Avatar } from './bits';
import { Dialog } from './dialog';
import { Icon } from './icons';
import { ReportDialog } from './template/panels';
import { useMe } from './header-account';
import { useToast } from './toast';
import { formatCompact, timeAgo } from '@/lib/format';
import type { Post, PostComment } from '@/lib/data/posts';

const MAX = 1500;
const MAX_COMMENT = 800;
type Kind = 'like' | 'dislike';

/**
 * "What's on your mind?" row that opens the post form in a popup. Signed-out
 * visitors see a sign-in prompt; with `onlyFor` the row only appears for that
 * person (their own profile). The server and the database validate everything
 * again, this is just the form.
 */
export function PostComposer({ onlyFor }: { onlyFor?: string }) {
  const me = useMe();
  const pathname = usePathname();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [length, setLength] = useState(0);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  if (me === undefined) return onlyFor ? null : <span className="skeleton block h-[76px] w-full rounded-2xl" />;
  if (onlyFor && me?.id !== onlyFor) return null;
  if (me === null) {
    return (
      <p className="m-0 rounded-2xl bg-surface-1 p-5 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
        <Link href={`/auth/sign-in?next=${encodeURIComponent(pathname)}`} className="font-medium text-accent-ink underline underline-offset-4">Sign in</Link> to share a post with the community.
      </p>
    );
  }

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      const r = await createPost(null, data);
      if (r?.error) return setError(r.error);
      formRef.current?.reset();
      setLength(0);
      setError(null);
      setOpen(false);
      toast({ text: 'Posted.', tone: 'ok' });
    });
  };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); requestAnimationFrame(() => bodyRef.current?.focus()); }}
              className="flex w-full items-center gap-3 rounded-2xl bg-surface-1 p-3 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-surface-2 md:p-4">
        <Avatar name={me.display_name} path={me.avatar_path} seed={me.username} size={44} />
        <span className="flex h-11 min-w-0 flex-1 items-center truncate rounded-full bg-surface-2 px-4 text-ink-3">
          What&apos;s on your mind, {me.display_name.split(' ')[0]}?
        </span>
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Create post" width={560}>
        <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={me.display_name} path={me.avatar_path} seed={me.username} size={40} />
            <div className="flex flex-col leading-tight">
              <span className="font-semibold">{me.display_name}</span>
              <span className="text-[13px] text-ink-3">Shared with the Yowkly community</span>
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Your post</span>
            <textarea ref={bodyRef} name="body" rows={5} maxLength={MAX} required onChange={(e) => setLength(e.target.value.length)}
                      placeholder="Share what you're building, a lesson, a question…" className="field h-auto resize-y py-2.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Tags</span>
            <input name="tags" maxLength={200} autoComplete="off" placeholder="Tags: react, design (up to 5, separated by spaces or commas)" className="field" />
          </label>
          {error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className={`font-mono text-xs ${length > MAX - 100 ? 'text-danger' : 'text-ink-3'}`}>{length}/{MAX}</span>
            <button className="btn btn-primary" disabled={pending}>{pending ? 'Posting…' : 'Post'}</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

type Counts = { like: number; dislike: number };

/** A list of posts, each with like, dislike, comments, a report link and (on your own) delete. */
export function PostList({ posts, emptyText }: { posts: Post[]; emptyText: string }) {
  const [me, setMe] = useState<string | null>(null);
  const [mine, setMine] = useState<Record<string, Kind>>({});
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toast = useToast();
  const ids = posts.map((p) => p.id).join(',');

  useEffect(() => {
    let live = true;
    if (!ids) return;
    postReactionStates(ids.split(',')).then((r) => { if (live) { setMe(r.me); setMine(r.reactions); } });
    return () => { live = false; };
  }, [ids]);

  const countsOf = (p: Post): Counts => counts[p.id] ?? { like: p.like_count, dislike: p.dislike_count };

  /** Tapping your current reaction takes it back; tapping the other one switches. */
  const react = (post: Post, kind: Kind) => {
    if (!me) return toast({ text: 'Sign in to react to posts.', tone: 'error' });
    const before = { reaction: mine[post.id], counts: countsOf(post) };
    const next = before.reaction === kind ? null : kind;
    const c = { ...before.counts };
    if (before.reaction) c[before.reaction] = Math.max(0, c[before.reaction] - 1);
    if (next) c[next] += 1;
    const put = (reaction: Kind | undefined, counts: Counts) => {
      setMine((m) => { const n = { ...m }; if (reaction) n[post.id] = reaction; else delete n[post.id]; return n; });
      setCounts((all) => ({ ...all, [post.id]: counts }));
    };
    put(next ?? undefined, c);
    setPostReaction(post.id, next).then((r) => {
      if (!r.ok) { put(before.reaction, before.counts); toast({ text: r.error, tone: 'error' }); }
    });
  };

  const visible = posts.filter((p) => !hidden.has(p.id));
  if (!visible.length) return <p className="m-0 rounded-xl border border-dashed border-line px-6 py-12 text-center text-ink-2">{emptyText}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-4 p-0">
      {visible.map((p) => (
        <li key={p.id}>
          <PostItem post={p} me={me} reaction={mine[p.id]} counts={countsOf(p)} onReact={(k) => react(p, k)}
                    onDeleted={() => setHidden((s) => new Set(s).add(p.id))} />
        </li>
      ))}
    </ul>
  );
}

function ReactionButton({ kind, active, count, onClick }: { kind: Kind; active: boolean; count: number; onClick: () => void }) {
  const label = kind === 'like' ? 'Like' : 'Dislike';
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={`${active ? `Remove your ${label.toLowerCase()}` : label}, ${count} so far`}
            className={`inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface-2 ${active ? 'text-accent-ink' : 'text-ink-2'}`}>
      <Icon name={kind === 'like' ? 'thumbUp' : 'thumbDown'} size={18} className={active ? 'like-pop fill-current' : ''} />
      <span className="font-mono">{formatCompact(count)}</span>
    </button>
  );
}

function PostItem({ post, me, reaction, counts, onReact, onDeleted }: {
  post: Post; me: string | null; reaction: Kind | undefined; counts: Counts; onReact: (k: Kind) => void; onDeleted: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const own = me === post.author_id;

  const remove = () => start(async () => {
    const r = await deletePost(post.id);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    onDeleted();
    toast({ text: 'Post deleted.', tone: 'ok' });
  });

  return (
    <article className="flex flex-col gap-3 rounded-2xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] md:p-5">
      <header className="flex items-center gap-3">
        <Link href={`/@${post.author_username}`} aria-label={`${post.author_display_name}'s profile`}>
          <Avatar name={post.author_display_name} path={post.author_avatar_path} seed={post.author_username} size={40} />
        </Link>
        <div className="flex min-w-0 flex-col leading-tight">
          <Link href={`/@${post.author_username}`} className="truncate font-semibold hover:text-accent-ink">{post.author_display_name}</Link>
          <span className="truncate text-[13px] text-ink-3">@{post.author_username} · <time dateTime={post.created_at}>{timeAgo(post.created_at)}</time></span>
        </div>
      </header>

      {/* Plain text only: React escapes it, and no links are made clickable. */}
      <p className="m-0 text-[15.5px] leading-relaxed break-words whitespace-pre-line">{post.body}</p>

      {post.tags.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Tags">
          {post.tags.map((t) => (
            <li key={t}><Link href={`/community?tag=${t}`} className="chip-stack hover:text-accent-ink">#{t}</Link></li>
          ))}
        </ul>
      )}

      <footer className="flex flex-wrap items-center gap-1 border-t border-line pt-2">
        <ReactionButton kind="like" active={reaction === 'like'} count={counts.like} onClick={() => onReact('like')} />
        <ReactionButton kind="dislike" active={reaction === 'dislike'} count={counts.dislike} onClick={() => onReact('dislike')} />
        <button type="button" onClick={() => setShowComments((v) => !v)} aria-expanded={showComments}
                aria-label={`Comments, ${commentCount} so far`}
                className={`inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface-2 ${showComments ? 'text-accent-ink' : 'text-ink-2'}`}>
          <Icon name="comment" size={18} />
          <span className="font-mono">{formatCompact(commentCount)}</span>
        </button>
        <span className="flex-1" />
        {own ? (
          confirming ? (
            <span className="flex items-center gap-1 text-sm">
              <span className="text-ink-2">Delete this post?</span>
              <button type="button" onClick={remove} disabled={pending} className="btn btn-danger h-9 px-3">Delete</button>
              <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost h-9 px-3">Keep</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm text-ink-3 hover:bg-surface-2 hover:text-danger">
              <Icon name="trash" size={16} />Delete
            </button>
          )
        ) : (
          <button type="button" onClick={() => (me ? setReporting(true) : toast({ text: 'Sign in to report a post.', tone: 'error' }))}
                  className="inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm text-ink-3 hover:bg-surface-2 hover:text-ink">
            <Icon name="flag" size={16} />Report
          </button>
        )}
      </footer>
      {reporting && <ReportDialog targetType="post" targetId={post.id} onClose={() => setReporting(false)} />}
      {showComments && <PostComments postId={post.id} postAuthorId={post.author_id} me={me} onCount={(d) => setCommentCount((n) => Math.max(0, n + d))} />}
    </article>
  );
}

/** Comments under one post: loaded when opened, oldest first, with a box to add yours. */
function PostComments({ postId, postAuthorId, me, onCount }: { postId: string; postAuthorId: string; me: string | null; onCount: (delta: number) => void }) {
  const toast = useToast();
  const pathname = usePathname();
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const [reporting, setReporting] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadPostComments(postId).then((c) => { if (live) setComments(c); });
    return () => { live = false; };
  }, [postId]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    start(async () => {
      const r = await addPostComment(postId, body);
      if (!r.ok) return toast({ text: r.error, tone: 'error' });
      setComments((list) => [...(list ?? []), r.data]);
      setText('');
      onCount(1);
    });
  };
  const remove = (c: PostComment) => start(async () => {
    const r = await removePostComment(c.id);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    setComments((list) => (list ?? []).filter((x) => x.id !== c.id));
    onCount(-1);
  });

  return (
    <section aria-label="Comments" className="flex flex-col gap-3 border-t border-line pt-3">
      {comments === null ? <span className="skeleton block h-10 w-full" /> : comments.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-3">No comments yet. Start the conversation.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Link href={`/@${c.author_username}`} aria-label={`${c.author_display_name}'s profile`} className="mt-0.5 shrink-0">
                <Avatar name={c.author_display_name} path={c.author_avatar_path} seed={c.author_username} size={32} />
              </Link>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="rounded-2xl bg-surface-2 px-3.5 py-2">
                  <Link href={`/@${c.author_username}`} className="text-[13.5px] font-semibold hover:text-accent-ink">{c.author_display_name}</Link>
                  <p className="m-0 text-[14.5px] break-words whitespace-pre-line">{c.body}</p>
                </div>
                <div className="flex items-center gap-3 px-2 text-xs text-ink-3">
                  <time dateTime={c.created_at}>{timeAgo(c.created_at)}</time>
                  {(me === c.author_id || me === postAuthorId) ? (
                    <button type="button" disabled={pending} onClick={() => remove(c)} className="hover:text-danger">Delete</button>
                  ) : (
                    <button type="button" onClick={() => (me ? setReporting(c.id) : toast({ text: 'Sign in to report a comment.', tone: 'error' }))} className="hover:text-ink">Report</button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {me ? (
        <form onSubmit={send} className="flex items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Write a comment</span>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_COMMENT} autoComplete="off" placeholder="Write a comment…" className="field" />
          </label>
          <button className="btn btn-primary" disabled={pending || !text.trim()}>Send</button>
        </form>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">
          <Link href={`/auth/sign-in?next=${encodeURIComponent(pathname)}`} className="font-medium text-accent-ink underline underline-offset-4">Sign in</Link> to comment.
        </p>
      )}
      {reporting && <ReportDialog targetType="post_comment" targetId={reporting} onClose={() => setReporting(null)} />}
    </section>
  );
}
