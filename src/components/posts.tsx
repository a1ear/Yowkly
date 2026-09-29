'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { createPost, deletePost, postLikeStates, setPostLike } from '@/app/actions/posts';
import { Avatar } from './bits';
import { Icon } from './icons';
import { ReportDialog } from './template/panels';
import { useMe } from './header-account';
import { useToast } from './toast';
import { keepFormOnSubmit } from '@/lib/use-kept-form';
import { formatCompact, timeAgo } from '@/lib/format';
import type { Post } from '@/lib/data/posts';

const MAX = 1500;

/**
 * Write a post. Signed-out visitors see a sign-in prompt; with `onlyFor` the box
 * only appears for that person (their own profile). The server and the database
 * validate everything again, this is just the form.
 */
export function PostComposer({ onlyFor }: { onlyFor?: string }) {
  const me = useMe();
  const pathname = usePathname();
  const [state, action, pending] = useActionState(createPost, null);
  const [length, setLength] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  if (me === undefined) return onlyFor ? null : <span className="skeleton block h-36 w-full rounded-2xl" />;
  if (onlyFor && me?.id !== onlyFor) return null;
  if (me === null) {
    return (
      <p className="m-0 rounded-2xl bg-surface-1 p-5 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
        <Link href={`/auth/sign-in?next=${encodeURIComponent(pathname)}`} className="font-medium text-accent-ink underline underline-offset-4">Sign in</Link> to share a post with the community.
      </p>
    );
  }
  return (
    <form ref={formRef} action={action} onSubmit={keepFormOnSubmit(action)} onReset={() => setLength(0)}
          className="flex flex-col gap-3 rounded-2xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] md:p-5">
      <div className="flex gap-3">
        <Avatar name={me.display_name} path={me.avatar_path} seed={me.username} size={40} />
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="sr-only">Your post</span>
          <textarea name="body" rows={3} maxLength={MAX} required placeholder="Share what you're building, a lesson, a question…"
                    onChange={(e) => setLength(e.target.value.length)} className="field h-auto resize-y py-2.5" />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="sr-only">Tags</span>
        <input name="tags" maxLength={200} autoComplete="off" placeholder="Tags: react, design (up to 5, separated by spaces or commas)" className="field" />
      </label>
      {state?.error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{state.error}</p>}
      {state?.ok && <p role="status" className="m-0 flex items-center gap-2 text-success"><Icon name="check" size={16} />Posted.</p>}
      <div className="flex items-center justify-between gap-3">
        <span className={`font-mono text-xs ${length > MAX - 100 ? 'text-danger' : 'text-ink-3'}`}>{length}/{MAX}</span>
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Posting…' : 'Post'}</button>
      </div>
    </form>
  );
}

/** A list of posts, each with a like button, a report link and (on your own) delete. */
export function PostList({ posts, emptyText }: { posts: Post[]; emptyText: string }) {
  const [me, setMe] = useState<string | null>(null);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const ids = posts.map((p) => p.id).join(',');

  useEffect(() => {
    let live = true;
    if (!ids) return;
    postLikeStates(ids.split(',')).then((r) => { if (live) { setMe(r.me); setLiked(new Set(r.liked)); } });
    return () => { live = false; };
  }, [ids]);

  const visible = posts.filter((p) => !hidden.has(p.id));
  if (!visible.length) return <p className="m-0 rounded-xl border border-dashed border-line px-6 py-12 text-center text-ink-2">{emptyText}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-4 p-0">
      {visible.map((p) => (
        <li key={p.id}>
          <PostItem post={p} me={me} liked={liked.has(p.id)} likes={counts[p.id] ?? p.like_count}
                    onLike={(on) => {
                      setLiked((s) => { const n = new Set(s); if (on) n.add(p.id); else n.delete(p.id); return n; });
                      setCounts((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? p.like_count) + (on ? 1 : -1)) }));
                    }}
                    onDeleted={() => setHidden((s) => new Set(s).add(p.id))} />
        </li>
      ))}
    </ul>
  );
}

function PostItem({ post, me, liked, likes, onLike, onDeleted }: {
  post: Post; me: string | null; liked: boolean; likes: number; onLike: (on: boolean) => void; onDeleted: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const own = me === post.author_id;

  const like = () => {
    if (!me) return toast({ text: 'Sign in to like posts.', tone: 'error' });
    const next = !liked;
    onLike(next);
    start(async () => {
      const r = await setPostLike(post.id, next);
      if (!r.ok) { onLike(!next); toast({ text: r.error, tone: 'error' }); }
    });
  };
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

      <footer className="flex items-center gap-1 border-t border-line pt-2">
        <button type="button" onClick={like} aria-pressed={liked} aria-label={`${liked ? 'Unlike' : 'Like'} this post, ${likes} like${likes === 1 ? '' : 's'}`}
                className={`inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface-2 ${liked ? 'text-accent-ink' : 'text-ink-2'}`}>
          <Icon name="heart" size={18} className={liked ? 'like-pop fill-current' : ''} />
          <span className="font-mono">{formatCompact(likes)}</span>
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
    </article>
  );
}
