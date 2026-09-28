'use client';
import { useSyncExternalStore } from 'react';

// A one-second clock as an external store: the server renders a placeholder,
// the browser ticks, and nothing sets state inside an effect.
const subscribe = (cb: () => void) => {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
const serverSnapshot = () => null;

/** Seconds until the next 00:00 UTC, when the Template of the Day job runs. */
function untilMidnightUtc(seconds: number) {
  const next = new Date(seconds * 1000);
  next.setUTCHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor(next.getTime() / 1000) - seconds);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
}
const pad = (n: number) => String(n).padStart(2, '0');

export function Countdown({ className = '' }: { className?: string }) {
  const now = useSyncExternalStore(subscribe, nowSeconds, serverSnapshot);
  const [h, m, s] = now == null ? [0, 0, 0] : untilMidnightUtc(now);
  return (
    <span
      role="timer"
      aria-label={now == null ? 'Next ranking countdown' : `Next Template of the Day in ${h} hours ${m} minutes`}
      className={`font-mono tracking-[0.02em] tabular-nums ${className}`}
    >
      {now == null ? '--:--:--' : <>{pad(h)}<span className="text-ink-3">:</span>{pad(m)}<span className="text-ink-3">:</span>{pad(s)}</>}
    </span>
  );
}
