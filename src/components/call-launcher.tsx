'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useMe } from './header-account';

// The call code (WebRTC + the realtime client) loads after the page is idle, and only for
// signed-in people, so it never slows down the first view of a page.
const CallManager = dynamic(() => import('./call-manager').then((m) => m.CallManager), { ssr: false });

export function CallLauncher() {
  const me = useMe();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!me) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => setReady(true), { timeout: 4000 });
    else { const id = setTimeout(() => setReady(true), 1500); return () => clearTimeout(id); }
  }, [me]);
  if (!me || !ready) return null;
  return <CallManager me={me.id} />;
}
