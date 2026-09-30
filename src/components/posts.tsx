'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { addPostComment, commentReactionStates, createPost, deletePost, updatePost, loadPostComments, postReactionStates, removePostComment, setCommentReaction, setPostReaction } from '@/app/actions/posts';
import { Avatar } from './bits';
import { Dialog } from './dialog';
import { PostImageGrid, PostImagePicker, type PostImageDraft } from './post-images';
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
  const [images, setImages] = useState<PostImageDraft[]>([]);
  const uploading = images.some((i) => i.state === 'uploading');

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
    const ready = images.filter((i) => i.state === 'ready' && i.path);
    if (!String(data.get('body') ?? '').trim() && !ready.length) return setError('Write something or add an image first.');
    data.set('images', JSON.stringify(ready.map((i) => ({ path: i.path, alt: i.alt.trim() || undefined, width: i.width, height: i.height }))));
    start(async () => {
      const r = await createPost(null, data);
      if (r?.error) return setError(r.error);
      formRef.current?.reset();
      for (const i of images) URL.revokeObjectURL(i.preview);
      setImages([]);
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
            <textarea ref={bodyRef} name="body" rows={5} maxLength={MAX} onChange={(e) => setLength(e.target.value.length)}
                      placeholder="Share what you're building, a lesson, a question…" className="field h-auto resize-y py-2.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Tags</span>
            <input name="tags" maxLength={200} autoComplete="off" placeholder="Tags: react, design (up to 5, separated by spaces or commas)" className="field" />
          </label>
          <PostImagePicker images={images} setImages={setImages} />
          {error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className={`font-mono text-xs ${length > MAX - 100 ? 'text-danger' : 'text-ink-3'}`}>{length}/{MAX}</span>
            <button className="btn btn-primary" disabled={pending || uploading}>{pending ? 'Posting…' : uploading ? 'Uploading…' : 'Post'}</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

type Counts = { like: number; dislike: number };

/** Tapping your current reaction takes it back; tapping the other one switches. */
function nextReaction(current: Kind | undefined, counts: Counts, kind: Kind): { reaction: Kind | null; counts: Counts } {
  const reaction = current === kind ? null : kind;
  const c = { ...counts };
  if (current) c[current] = Math.max(0, c[current] - 1);
  if (reaction) c[reaction] += 1;
  return { reaction, counts: c };
}

/** The two comments worth showing under a post: most liked first, newest breaks ties. */
const bestTwo = (list: PostComment[]) =>
  [...list].sort((a, b) => (b.like_count - b.dislike_count) - (a.like_count - a.dislike_count) || b.created_at.localeCompare(a.created_at)).slice(0, 2);

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

  const react = (post: Post, kind: Kind) => {
    if (!me) return toast({ text: 'Sign in to react to posts.', tone: 'error' });
    const before = { reaction: mine[post.id], counts: countsOf(post) };
    const { reaction: next, counts: c } = nextReaction(before.reaction, before.counts, kind);
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
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState({ body: post.body, tags: post.tags, edited: Boolean(post.edited_at) });
  const menuRef = useRef<HTMLDivElement>(null);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [live, setLive] = useState<PostComment[] | null>(null);
  const previews = live ? bestTwo(live) : post.previews;
  const own = me === post.author_id;

  // Close the ⋮ menu on Escape or a click outside it.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menu]);

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
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <Link href={`/@${post.author_username}`} className="truncate font-semibold hover:text-accent-ink">{post.author_display_name}</Link>
          <span className="truncate text-[13px] text-ink-3">@{post.author_username} · <time dateTime={post.created_at}>{timeAgo(post.created_at)}</time>{content.edited && ' · Edited'}</span>
        </div>
        <div ref={menuRef} className="relative">
          <button type="button" onClick={() => setMenu((v) => !v)} aria-label="Post options" aria-haspopup="menu" aria-expanded={menu}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink">
            <Icon name="kebab" size={18} />
          </button>
          {menu && (
            <div role="menu" className="absolute top-11 right-0 z-10 w-44 rounded-xl bg-surface-1 p-1.5 shadow-e2 ring-1 ring-line">
              {own ? (
                <>
                  <button role="menuitem" type="button" onClick={() => { setMenu(false); setEditing(true); }}
                          className="flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm hover:bg-surface-2">
                    <Icon name="settings" size={16} />Edit post
                  </button>
                  <button role="menuitem" type="button" onClick={() => { setMenu(false); setConfirming(true); }}
                          className="flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm text-danger hover:bg-surface-2">
                    <Icon name="trash" size={16} />Delete post
                  </button>
                </>
              ) : (
                <button role="menuitem" type="button" onClick={() => { setMenu(false); if (me) setReporting(true); else toast({ text: 'Sign in to report a post.', tone: 'error' }); }}
                        className="flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm hover:bg-surface-2">
                  <Icon name="flag" size={16} />Report post
                </button>
              )}
            </div>
          )}
        </div>
      </header>
      {confirming && (
        <div role="alertdialog" aria-label="Delete this post?" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <span className="text-ink-2">Delete this post? This can&apos;t be undone.</span>
          <span className="flex gap-1">
            <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost h-9 px-3">Keep</button>
            <button type="button" onClick={remove} disabled={pending} className="btn btn-danger h-9 px-3">Delete</button>
          </span>
        </div>
      )}
      {editing && <EditPost post={post} content={content} onClose={() => setEditing(false)} onSaved={(c) => { setContent({ ...c, edited: true }); setEditing(false); }} />}

      {/* Plain text only: React escapes it, and no links are made clickable. */}
      {content.body && <p className="m-0 text-[15.5px] leading-relaxed break-words whitespace-pre-line">{content.body}</p>}
      <PostImageGrid images={post.images ?? []} author={post.author_display_name} />

      {content.tags.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[13px]" aria-label="Tags">
          {content.tags.map((t) => (
            <li key={t}><Link href={`/community?tag=${t}`} className="text-ink-3 hover:text-accent-ink">{t}</Link></li>
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
      </footer>
      {reporting && <ReportDialog targetType="post" targetId={post.id} onClose={() => setReporting(false)} />}
      {!showComments && previews.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Top comments">
            {previews.map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <Link href={`/@${c.author_username}`} aria-label={`${c.author_display_name}'s profile`} className="mt-0.5 shrink-0">
                  <Avatar name={c.author_display_name} path={c.author_avatar_path} seed={c.author_username} size={28} />
                </Link>
                <div className="min-w-0 rounded-2xl bg-surface-2 px-3.5 py-2">
                  <Link href={`/@${c.author_username}`} className="text-[13px] font-semibold hover:text-accent-ink">{c.author_display_name}</Link>
                  <p className="m-0 line-clamp-3 text-[14px] break-words whitespace-pre-line">{c.body}</p>
                  {(c.like_count > 0 || c.dislike_count > 0) && (
                    <span className="mt-0.5 flex items-center gap-3 text-xs text-ink-3">
                      {c.like_count > 0 && <span className="inline-flex items-center gap-1"><Icon name="thumbUp" size={12} />{formatCompact(c.like_count)}</span>}
                      {c.dislike_count > 0 && <span className="inline-flex items-center gap-1"><Icon name="thumbDown" size={12} />{formatCompact(c.dislike_count)}</span>}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setShowComments(true)} className="self-start rounded-md px-1 py-2 text-[13px] font-medium text-ink-2 hover:text-accent-ink">
            {commentCount > previews.length ? `View all ${formatCompact(commentCount)} comments` : 'Reply or react'}
          </button>
        </div>
      )}
      {showComments && <PostComments postId={post.id} postAuthorId={post.author_id} me={me} onList={setLive} onCount={(d) => setCommentCount((n) => Math.max(0, n + d))} />}
    </article>
  );
}

function MiniReaction({ kind, active, count, onClick }: { kind: Kind; active: boolean; count: number; onClick: () => void }) {
  const label = kind === 'like' ? 'Like' : 'Dislike';
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={`${active ? `Remove your ${label.toLowerCase()}` : `${label} this comment`}, ${count} so far`}
            className={`-my-1 inline-flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 hover:bg-surface-3 ${active ? 'text-accent-ink' : 'text-ink-3'}`}>
      <Icon name={kind === 'like' ? 'thumbUp' : 'thumbDown'} size={14} className={active ? 'fill-current' : ''} />
      {count > 0 && <span className="font-mono">{formatCompact(count)}</span>}
    </button>
  );
}

/** Comments under one post: loaded when opened, oldest first, with a box to add yours. */
function PostComments({ postId, postAuthorId, me, onCount, onList }: {
  postId: string; postAuthorId: string; me: string | null; onCount: (delta: number) => void; onList: (list: PostComment[]) => void;
}) {
  const toast = useToast();
  const pathname = usePathname();
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [mine, setMine] = useState<Record<string, Kind>>({});
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const [reporting, setReporting] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadPostComments(postId).then(async (c) => {
      if (!live) return;
      setComments(c);
      onList(c);
      const r = await commentReactionStates(c.map((x) => x.id));
      if (live) setMine(r);
    });
    return () => { live = false; };
    // onList is a state setter from the parent, stable for the life of the post.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const update = (next: PostComment[]) => { setComments(next); onList(next); };
  const reactTo = (c: PostComment, kind: Kind) => {
    if (!me) return toast({ text: 'Sign in to react to comments.', tone: 'error' });
    const before = { reaction: mine[c.id], counts: { like: c.like_count, dislike: c.dislike_count } };
    const { reaction, counts } = nextReaction(before.reaction, before.counts, kind);
    const put = (r: Kind | undefined, k: Counts) => {
      setMine((m) => { const n = { ...m }; if (r) n[c.id] = r; else delete n[c.id]; return n; });
      setComments((list) => (list ?? []).map((x) => (x.id === c.id ? { ...x, like_count: k.like, dislike_count: k.dislike } : x)));
    };
    put(reaction ?? undefined, counts);
    setCommentReaction(c.id, reaction).then((r) => {
      if (!r.ok) { put(before.reaction, before.counts); toast({ text: r.error, tone: 'error' }); }
    });
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    start(async () => {
      const r = await addPostComment(postId, body);
      if (!r.ok) return toast({ text: r.error, tone: 'error' });
      update([...(comments ?? []), r.data]);
      setText('');
      onCount(1);
    });
  };
  const remove = (c: PostComment) => start(async () => {
    const r = await removePostComment(c.id);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    update((comments ?? []).filter((x) => x.id !== c.id));
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
                  <MiniReaction kind="like" active={mine[c.id] === 'like'} count={c.like_count} onClick={() => reactTo(c, 'like')} />
                  <MiniReaction kind="dislike" active={mine[c.id] === 'dislike'} count={c.dislike_count} onClick={() => reactTo(c, 'dislike')} />
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

/** The edit popup: same limits as a new post; the server and the database check them again. */
function EditPost({ post, content, onClose, onSaved }: {
  post: Post; content: { body: string; tags: string[] };
  onClose: () => void; onSaved: (c: { body: string; tags: string[] }) => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState(content.body);
  const [tags, setTags] = useState(content.tags.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await updatePost(post.id, body, tags);
      if (!r.ok) return setError(r.error);
      toast({ text: 'Post updated.', tone: 'ok' });
      onSaved(r.data);
    });
  };
  return (
    <Dialog open onClose={onClose} title="Edit post" width={560}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="sr-only">Your post</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={MAX} required autoFocus className="field h-auto resize-y py-2.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="sr-only">Tags</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} maxLength={200} autoComplete="off" placeholder="Tags: react, design (up to 5)" className="field" />
        </label>
        {error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <span className={`font-mono text-xs ${body.length > MAX - 100 ? 'text-danger' : 'text-ink-3'}`}>{body.length}/{MAX}</span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
            <button className="btn btn-primary" disabled={pending || !body.trim()}>{pending ? 'Saving…' : 'Save changes'}</button>
          </span>
        </div>
      </form>
    </Dialog>
  );
}
