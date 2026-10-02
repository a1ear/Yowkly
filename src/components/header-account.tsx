'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signOut as serverSignOut } from '@/app/actions/auth';
import { MESSAGES_EVENT, YOWKBITS_EVENT } from '@/lib/events';
import { Icon } from './icons';
import { Avatar } from './bits';
import { NotificationsBell } from './notifications-popover';
import { MessagesBell } from './messages-popover';
import { MODE_OPTIONS, PresenceHeartbeat, StatusDot } from './presence';
import { setMyStatus } from '@/app/actions/friends';
import type { StatusMode } from '@/app/actions/friends';

type Me = {
  id: string; username: string; display_name: string; avatar_path: string | null; unread: number; balance: number;
  /** Staff role for the admin panel link: 'admin', 'moderator', 'reviewer' (sub-admin) or null. */
  role: 'admin' | 'moderator' | 'reviewer' | null;
  /** What the person chose: online, idle or invisible (appear offline). */
  status_mode: StatusMode;
  unread_messages: number;
};

/**
 * Loads the signed-in user in the browser so every public page can stay cached.
 * Uses /api/me rather than the Supabase client, which keeps ~65 KB of
 * JavaScript off pages that don't otherwise need it.
 */
export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  // Sign-in/out happen in server actions followed by a client navigation, so
  // re-check on every route change.
  const pathname = usePathname();
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/me', { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { me: null }))
      .then((d: { me: Me | null }) => setMe(d.me))
      .catch(() => { if (!ctrl.signal.aborted) setMe(null); });
    // A vote on a template page reports the new balance straight away.
    const onSpend = (e: Event) => setMe((m) => (m ? { ...m, balance: Number((e as CustomEvent).detail) } : m));
    window.addEventListener(YOWKBITS_EVENT, onSpend);
    const onMessages = (e: Event) => setMe((m) => (m ? { ...m, unread_messages: Number((e as CustomEvent).detail) } : m));
    window.addEventListener(MESSAGES_EVENT, onMessages);
    return () => {
      ctrl.abort();
      window.removeEventListener(YOWKBITS_EVENT, onSpend);
      window.removeEventListener(MESSAGES_EVENT, onMessages);
    };
  }, [pathname]);
  return me;
}

export function HeaderAccount() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  // Cleared locally for this copy of `me`; the next /api/me load brings the real count back.
  const [clearedFor, setClearedFor] = useState<Me | null>(null);
  const [modeOverride, setModeOverride] = useState<StatusMode | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const mode: StatusMode = modeOverride ?? me?.status_mode ?? 'online';

  async function signOut() {
    setOpen(false);
    await serverSignOut(); // clears the session cookie and redirects home
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1 md:gap-2">
      <Link href="/upload" className="btn btn-primary hidden md:inline-flex">
        <Icon name="upload" size={16} strokeWidth={2} />
        Upload
      </Link>
      {me === undefined && <span className="skeleton h-9 w-9 rounded-full" aria-hidden="true" />}
      {me === null && (
        <Link href="/auth/sign-in" className="btn btn-secondary h-10 px-4">
          Sign in
        </Link>
      )}
      {me && (
        <>
          <PresenceHeartbeat />
          <Link
            href="/ranking#yowkbits"
            title="Yowkbits: spend 1 to vote for a template"
            aria-label={`${me.balance} yowkbits left`}
            className="bit-chip inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line)] hover:text-accent-ink sm:px-3"
          >
            <Icon name="bit" size={15} strokeWidth={2} className="text-accent-ink" />
            <span key={me.balance} className="count-pop">{me.balance}</span>
          </Link>
          {me.role && (
            <Link href="/admin" title={me.role === 'reviewer' ? 'Review queue' : 'Admin panel'} aria-label={me.role === 'reviewer' ? 'Review queue' : 'Admin panel'}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-surface-2 hover:text-accent-ink">
              <Icon name="shield" size={20} />
            </Link>
          )}
          <MessagesBell unread={me.unread_messages} />
          <NotificationsBell unread={clearedFor === me ? 0 : me.unread} onRead={() => setClearedFor(me)} />
          <div ref={menuRef} className="relative hidden md:block">
            <button
              type="button"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-full"
            >
              <Avatar name={me.display_name} path={me.avatar_path} seed={me.username} size={34} />
              <StatusDot status={mode === 'invisible' ? 'offline' : mode} size={11} ring="var(--canvas)" className="absolute right-0.5 bottom-0.5" />
            </button>
            {open && (
              <div role="menu" className="absolute top-12 right-0 w-56 rounded-xl bg-surface-1 p-1.5 shadow-e2 ring-1 ring-line">
                <p className="m-0 truncate px-3 pt-2 pb-1 text-[13px] text-ink-3">@{me.username}</p>
                <div role="group" aria-label="Your status" className="mb-1 border-b border-line pb-1.5">
                  {MODE_OPTIONS.map(([value, label, hint]) => (
                    <button key={value} role="menuitemradio" aria-checked={mode === value} type="button" title={hint}
                            onClick={async () => { setModeOverride(value); const r = await setMyStatus(value); if (!r.ok) setModeOverride(null); }}
                            className="flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm text-ink hover:bg-surface-2">
                      <StatusDot status={value === 'invisible' ? 'offline' : value} size={10} ring="transparent" />
                      <span className="flex-1">{label}</span>
                      {mode === value && <Icon name="check" size={14} className="text-accent-ink" />}
                    </button>
                  ))}
                </div>
                {[
                  [`/@${me.username}`, 'Your profile', 'user'],
                  ['/dashboard', 'Creator dashboard', 'grid'],
                  ['/settings', 'Settings', 'settings'],
                  ...(me.role ? [['/admin', me.role === 'reviewer' ? 'Review queue' : 'Admin panel', 'shield']] : []),
                ].map(([href, label, icon]) => (
                  <Link key={href} role="menuitem" href={href} onClick={() => setOpen(false)}
                        className="flex h-10 items-center gap-2.5 rounded-md px-3 text-sm text-ink hover:bg-surface-2">
                    <Icon name={icon as 'user'} size={16} />
                    {label}
                  </Link>
                ))}
                <button role="menuitem" type="button" onClick={signOut}
                        className="flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm text-ink hover:bg-surface-2">
                  <Icon name="logout" size={16} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
