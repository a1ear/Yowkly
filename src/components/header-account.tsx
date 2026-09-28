'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';
import { Icon } from './icons';
import { Avatar } from './bits';

type Me = { id: string; username: string; display_name: string; avatar_path: string | null; unread: number };

/** Loads the signed-in user in the browser so every public page can stay cached. */
export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  // Sign-in/out happen in server actions followed by a client navigation, which
  // fires no auth event in the browser, so re-check on every route change too.
  const pathname = usePathname();
  useEffect(() => {
    const db = browserClient();
    let cancelled = false;
    async function load() {
      const { data } = await db.auth.getClaims();
      const uid = data?.claims?.sub;
      if (!uid) return !cancelled && setMe(null);
      const [{ data: p }, { count }] = await Promise.all([
        db.from('profiles').select('id, username, display_name, avatar_path').eq('id', uid).maybeSingle(),
        db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
      ]);
      if (!cancelled) setMe(p ? { ...p, unread: count ?? 0 } : null);
    }
    load();
    const { data: sub } = db.auth.onAuthStateChange(() => load());
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [pathname]);
  return me;
}

export function HeaderAccount() {
  const me = useMe();
  const [open, setOpen] = useState(false);
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

  async function signOut() {
    await browserClient().auth.signOut();
    setOpen(false);
    router.push('/');
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
          <Link
            href="/notifications"
            aria-label={me.unread ? `Notifications, ${me.unread} unread` : 'Notifications'}
            className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-surface-2"
          >
            <Icon name="bell" size={20} />
            {me.unread > 0 && <span className="absolute top-2.5 right-[11px] h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--canvas)]" />}
          </Link>
          <div ref={menuRef} className="relative hidden md:block">
            <button
              type="button"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full"
            >
              <Avatar name={me.display_name} path={me.avatar_path} seed={me.username} size={34} />
            </button>
            {open && (
              <div role="menu" className="absolute top-12 right-0 w-56 rounded-xl bg-surface-1 p-1.5 shadow-e2 ring-1 ring-line">
                <p className="m-0 truncate px-3 pt-2 pb-1 text-[13px] text-ink-3">@{me.username}</p>
                {[
                  [`/@${me.username}`, 'Your profile', 'user'],
                  ['/dashboard', 'Creator dashboard', 'grid'],
                  ['/settings', 'Settings', 'settings'],
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

/** ⌘K / Ctrl+K focuses the header search. */
export function SearchShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('site-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
