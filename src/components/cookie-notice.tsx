'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

const KEY = 'yowkly-cookie-notice';
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) === 'ok'; } catch { return false; } };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/**
 * Yowkly sets only strictly necessary cookies (the sign-in session) and uses
 * cookie-free analytics, so there is nothing to opt into: this is a notice,
 * not a consent wall. If non-essential cookies are ever added, this must
 * become a real opt-in before they load.
 */
export function CookieNotice() {
  const seen = useSyncExternalStore(subscribe, read, () => true);
  if (seen) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, 'ok'); } catch { /* private mode: show again next time */ }
    listeners.forEach((l) => l());
  };
  return (
    <div role="region" aria-label="Cookie notice"
         className="rise fixed inset-x-3 bottom-[76px] z-50 mx-auto flex max-w-xl flex-col gap-3 rounded-xl bg-surface-2 p-4 text-[13.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-e2)] sm:flex-row sm:items-center md:bottom-5">
      <p className="m-0 flex-1">
        We only use the cookies needed to keep you signed in, plus cookie-free analytics. No ads, no tracking.{' '}
        <Link href="/legal/privacy#cookies" className="text-accent-ink underline underline-offset-4">Privacy</Link>
      </p>
      <button type="button" onClick={dismiss} className="btn btn-primary h-10 shrink-0">Got it</button>
    </div>
  );
}
