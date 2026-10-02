'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { friendsList, myFriends, type Friend } from '@/app/actions/friends';
import { Avatar } from './bits';
import { Icon } from './icons';
import { STATUS_LABEL, StatusDot } from './presence';
import { useMe } from './header-account';
import { MessageButton } from './message-button';

/** Community sidebar: your friends with their status, refreshed every minute. */
export function FriendsSidebar() {
  const me = useMe();
  const [friends, setFriends] = useState<Friend[] | null>(null);

  useEffect(() => {
    if (!me) return;
    let live = true;
    const load = () => myFriends().then((f) => { if (live) setFriends(f ?? []); });
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => { live = false; clearInterval(id); };
  }, [me]);

  if (me === null) {
    return (
      <p className="m-0 px-2 text-[13px] text-ink-2">
        <Link href="/auth/sign-in?next=/community" className="font-medium text-accent-ink underline underline-offset-4">Sign in</Link> to see which friends are online.
      </p>
    );
  }
  const online = (friends ?? []).filter((f) => f.status === 'online').length;
  return (
    <section aria-labelledby="friends-title" className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between px-2 pt-1">
        <h2 id="friends-title" className="m-0 text-sm font-semibold">Friends</h2>
        {friends && friends.length > 0 && <span className="font-mono text-[11px] text-ink-3">{online} online</span>}
      </div>
      {friends === null ? (
        <div className="flex flex-col gap-2 p-1">{[0, 1, 2].map((i) => <span key={i} className="skeleton block h-10 w-full" />)}</div>
      ) : friends.length === 0 ? (
        <p className="m-0 px-2 pb-2 text-[13px] text-ink-3">Friends are people you follow who follow you back. Follow creators you like; when they follow back they show up here.</p>
      ) : (
        <ul className="m-0 flex max-h-[70vh] list-none flex-col overflow-y-auto p-0">
          {friends.map((f) => <FriendRow key={f.id} f={f} />)}
        </ul>
      )}
    </section>
  );
}

function FriendRow({ f }: { f: Friend }) {
  const status = f.status ?? 'offline';
  return (
    <li className="group flex items-center gap-1">
      <Link href={`/@${f.username}`} className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2 ${status === 'offline' ? 'opacity-60' : ''}`}>
        <span className="relative shrink-0">
          <Avatar name={f.display_name} path={f.avatar_path} seed={f.username} size={34} />
          {f.status && <StatusDot status={status} size={11} className="absolute -right-0.5 -bottom-0.5" />}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[14px] font-medium">{f.display_name}</span>
          <span className="truncate text-[12px] text-ink-3">{f.status ? STATUS_LABEL[status] : `@${f.username}`}</span>
        </span>
      </Link>
      {f.status && <MessageButton userId={f.id} compact className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-accent-ink" />}
    </li>
  );
}

/** A profile's Friends tab link: only there for the owner, or for everyone when the list is public. */
export function FriendsTabLink({ userId, href, active }: { userId: string; href: string; active: boolean }) {
  const [state, setState] = useState<{ visible: boolean; count: number; own: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    friendsList(userId).then((r) => { if (live) setState({ visible: r.visible, count: r.friends.length, own: r.own }); });
    return () => { live = false; };
  }, [userId]);
  if (!state?.visible) return null;
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}
          className="-mb-px inline-flex h-12 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-ink-2 hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink">
      Friends<span className="font-mono text-[11.5px] text-ink-3">{state.count}</span>
      {state.own && <Icon name="lock" size={12} className="text-ink-3" aria-label="Only you can see this unless you make it public" />}
    </Link>
  );
}

/** The Friends tab body. Private lists say so instead of listing anyone. */
export function FriendsTab({ userId, name }: { userId: string; name: string }) {
  const [data, setData] = useState<{ visible: boolean; own: boolean; friends: Friend[] } | null>(null);
  useEffect(() => {
    let live = true;
    friendsList(userId).then((r) => { if (live) setData(r); });
    return () => { live = false; };
  }, [userId]);
  if (!data) return <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton block h-16" />)}</div>;
  if (!data.visible) return <p className="m-0 rounded-xl border border-dashed border-line px-6 py-12 text-center text-ink-2">{name} keeps their friends list private.</p>;
  return (
    <div className="flex flex-col gap-4">
      {data.own && (
        <p className="m-0 flex items-center gap-2 text-[13px] text-ink-3">
          <Icon name="lock" size={13} />You can always see this. Choose whether others can in <Link href="/settings#friends" className="text-accent-ink underline-offset-4 hover:underline">Settings</Link>.
        </p>
      )}
      {data.friends.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-line px-6 py-12 text-center text-ink-2">No friends yet. Friends are people who follow each other.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {data.friends.map((f) => (
            <li key={f.id}>
              <Link href={`/@${f.username}`} className="card-hover flex items-center gap-3 rounded-xl bg-surface-1 p-3 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2">
                <Avatar name={f.display_name} path={f.avatar_path} seed={f.username} size={44} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{f.display_name}</span>
                  <span className="truncate text-[13px] text-ink-3">@{f.username}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
