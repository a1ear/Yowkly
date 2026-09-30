'use client';
import { useEffect, useState } from 'react';
import { userStatus, type Status, type StatusMode } from '@/app/actions/friends';

export const STATUS_LABEL: Record<Status, string> = { online: 'Online', idle: 'Idle', offline: 'Offline' };
export const MODE_OPTIONS: [StatusMode, string, string][] = [
  ['online', 'Online', 'Friends see you as online while you use Yowkly.'],
  ['idle', 'Idle', 'Friends see you as away.'],
  ['invisible', 'Appear offline', 'You can use Yowkly as usual; friends see you as offline.'],
];

/** The little status dot: green online, amber idle (a moon-style ring), grey offline. */
export function StatusDot({ status, size = 12, ring = 'var(--surface-1)', className = '' }: {
  status: Status; size?: number; ring?: string; className?: string;
}) {
  const color = status === 'online' ? '#3BD671' : status === 'idle' ? '#F0B232' : '#80848E';
  return (
    <span role="img" aria-label={STATUS_LABEL[status]} title={STATUS_LABEL[status]} className={`inline-block shrink-0 rounded-full ${className}`}
          style={{ width: size, height: size, background: color, boxShadow: `0 0 0 ${Math.max(2, Math.round(size / 5))}px ${ring}` }} />
  );
}

/** A user's status dot, shown only if the viewer is their friend (or them). Renders nothing otherwise. */
export function UserStatusDot({ userId, size, ring, className }: { userId: string; size?: number; ring?: string; className?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let live = true;
    userStatus(userId).then((s) => { if (live) setStatus(s); });
    return () => { live = false; };
  }, [userId]);
  return status ? <StatusDot status={status} size={size} ring={ring} className={className} /> : null;
}

/**
 * Tells the server you're here about once a minute while the site is open, and
 * whether you've touched the page in the last 10 minutes (otherwise you show as
 * idle). Stops while the tab is hidden, so a forgotten tab goes offline.
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    let lastInput = Date.now();
    const mark = () => { lastInput = Date.now(); };
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/presence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ active: Date.now() - lastInput < 10 * 60 * 1000 }),
      }).catch(() => {});
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'pointermove'] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true });
    const onVisible = () => { if (document.visibilityState === 'visible') { mark(); beat(); } };
    document.addEventListener('visibilitychange', onVisible);
    beat();
    const id = setInterval(beat, 60_000);
    return () => {
      clearInterval(id);
      for (const e of events) window.removeEventListener(e, mark);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return null;
}
