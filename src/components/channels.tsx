'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { createChannel, joinChannel, leaveChannel, myChannelState, myChannels, type MyChannel } from '@/app/actions/channels';
import { Dialog } from './dialog';
import { Icon } from './icons';
import { PostComposer, PostList } from './posts';
import { useMe } from './header-account';
import { revalidate, useCached } from '@/lib/use-cached';
import { useToast } from './toast';
import { formatCompact } from '@/lib/format';
import type { Post } from '@/lib/data/posts';

const toSlug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31);

/** Community, left column: create a channel, your channels, and a way to find more. */
export function ChannelsSidebar() {
  const me = useMe();
  const cached = useCached<MyChannel[] | null>(me ? 'my-channels' : null, myChannels, 60_000);
  const mine = cached === undefined ? null : (cached ?? []);
  const [creating, setCreating] = useState(false);

  return (
    <nav aria-label="Channels" className="flex flex-col gap-4">
      {me ? (
        <button type="button" onClick={() => setCreating(true)} className="btn btn-primary w-full"><Icon name="plus" size={16} />Create channel</button>
      ) : me === null ? (
        <Link href="/auth/sign-in?next=/community" className="btn btn-secondary w-full">Sign in to create a channel</Link>
      ) : <span className="skeleton block h-11" />}

      <div className="flex flex-col gap-1">
        <h2 className="eyebrow m-0 px-2 pb-1">Your channels</h2>
        {me === null ? null : mine === null ? (
          <div className="flex flex-col gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="skeleton block h-9" />)}</div>
        ) : mine.length === 0 ? (
          <p className="m-0 px-2 text-[13px] text-ink-3">You haven&apos;t joined any channels yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {mine.map((c) => (
              <li key={c.id}>
                <Link href={`/community/c/${c.slug}`} className="flex h-10 items-center gap-2.5 rounded-lg px-2 text-[14px] hover:bg-surface-1">
                  <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-[12px] text-accent-ink">#</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.role !== 'member' && <span className="font-mono text-[10.5px] text-ink-3 uppercase">{c.role}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link href="/community/channels" className="inline-flex items-center gap-1.5 px-2 text-[13.5px] font-medium text-accent-ink hover:underline">
        Browse all channels<Icon name="chevronRight" size={14} />
      </Link>
      {creating && <CreateChannelDialog onClose={() => setCreating(false)} />}
    </nav>
  );
}

export function CreateChannelDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const address = slugTouched ? slug : toSlug(name);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await createChannel({ name, slug: address, description });
      if (!r.ok) return setError(r.error);
      toast({ text: 'Channel created. You are its owner.', tone: 'ok' });
      revalidate('my-channels', myChannels);
      onClose();
      router.push(`/community/c/${r.data.slug}`);
    });
  };
  return (
    <Dialog open onClose={onClose} title="Create a channel" width={520}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="m-0 -mt-2 text-[13.5px] text-ink-2">A channel is a space for one topic. You&apos;ll be its owner: you can add moderators, manage members and set rules.</p>
        <label className="flex flex-col gap-1.5">
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={40} autoFocus placeholder="React Builders" className="field" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Address</span>
          <span className="flex items-center gap-0 rounded-md shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_2px_var(--accent)]">
            <span className="pl-3 font-mono text-[13px] text-ink-3">/community/c/</span>
            <input value={address} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }}
                   required pattern="[a-z0-9][a-z0-9-]{2,30}" maxLength={31} className="h-11 min-w-0 flex-1 bg-transparent pr-3 font-mono text-[13px] outline-none" />
          </span>
          <span className="text-[12px] text-ink-3">Lowercase letters, numbers and dashes. This can&apos;t be changed later.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">What is it about? <span className="font-normal text-ink-3">(optional)</span></span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={3} className="field h-auto py-2.5"
                    placeholder="Sharing and reviewing React projects, from first apps to production." />
        </label>
        {error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button className="btn btn-primary" disabled={pending}>{pending ? 'Creating…' : 'Create channel'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The interactive part of a channel page: Join/Leave, the Manage link for staff,
 * the composer for members, and the feed (with "Remove post" for staff).
 */
export function ChannelBody({ channel, posts }: { channel: { id: string; slug: string; name: string; member_count: number }; posts: Post[] }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<Awaited<ReturnType<typeof myChannelState>> | null>(null);
  const [members, setMembers] = useState(channel.member_count);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    myChannelState(channel.id).then((s) => { if (live) setState(s); });
    return () => { live = false; };
  }, [channel.id]);

  const staff = state?.role === 'owner' || state?.role === 'mod' || Boolean(state?.siteMod);
  const toggle = () => start(async () => {
    if (!state?.signedIn) return router.push(`/auth/sign-in?next=/community/c/${channel.slug}`);
    const joining = !state.role;
    const before = state;
    setState({ ...state, role: joining ? 'member' : null }); // optimistic
    setMembers((n) => n + (joining ? 1 : -1));
    const r = joining ? await joinChannel(channel.id, channel.slug) : await leaveChannel(channel.id, channel.slug);
    if (!r.ok) {
      setState(before);
      setMembers((n) => n - (joining ? 1 : -1));
      return toast({ text: r.error, tone: 'error' });
    }
    revalidate('my-channels', myChannels);
    toast({ text: joining ? `You joined ${channel.name}.` : `You left ${channel.name}.`, tone: 'ok' });
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] text-ink-3">{formatCompact(members)} member{members === 1 ? '' : 's'}</span>
        <span className="flex-1" />
        {state === null ? <span className="skeleton block h-10 w-24" /> : state.banned ? (
          <span className="rounded-full bg-surface-2 px-3 py-2 text-[13px] text-danger">You are banned: {state.banned}</span>
        ) : state.role === 'owner' ? (
          <span className="rounded-full bg-surface-2 px-3 py-2 text-[13px] text-ink-2">You own this channel</span>
        ) : (
          <button type="button" onClick={toggle} disabled={pending} className={state.role ? 'btn btn-secondary' : 'btn btn-primary'}>
            {state.role ? <><Icon name="check" size={16} />Joined</> : <><Icon name="plus" size={16} />Join</>}
          </button>
        )}
        {staff && <Link href={`/community/c/${channel.slug}/manage`} className="btn btn-secondary"><Icon name="settings" size={16} />Manage</Link>}
      </div>

      {state?.role ? <PostComposer channel={{ id: channel.id, name: channel.name }} /> : state && !state.banned && (
        <p className="m-0 rounded-2xl bg-surface-1 p-4 text-[14px] text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
          Join {channel.name} to post and comment here.
        </p>
      )}
      <PostList posts={posts} canModerate={staff} drafts={{ channelId: channel.id }} emptyText={`Nothing in ${channel.name} yet. Start the first conversation.`} />
    </div>
  );
}
