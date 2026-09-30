'use client';
import { useState, useTransition } from 'react';
import { setFriendsPublic, setMyStatus, type StatusMode } from '@/app/actions/friends';
import { MODE_OPTIONS, StatusDot } from './presence';
import { useToast } from './toast';

/** Activity status and friends-list privacy. Each change saves on its own. */
export function SocialSettings({ initialMode, initialPublic }: { initialMode: StatusMode; initialPublic: boolean }) {
  const toast = useToast();
  const [mode, setMode] = useState(initialMode);
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [pending, start] = useTransition();

  const pickMode = (next: StatusMode) => {
    const before = mode;
    setMode(next);
    start(async () => {
      const r = await setMyStatus(next);
      if (!r.ok) { setMode(before); toast({ text: r.error, tone: 'error' }); }
    });
  };
  const togglePublic = (next: boolean) => {
    setIsPublic(next);
    start(async () => {
      const r = await setFriendsPublic(next);
      if (!r.ok) { setIsPublic(!next); return toast({ text: r.error, tone: 'error' }); }
      toast({ text: next ? 'Your friends list is public.' : 'Your friends list is private.', tone: 'ok' });
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="label mb-2">Activity status</legend>
        <p className="m-0 -mt-1 mb-1 text-[13px] text-ink-3">Only your friends see it. You show as offline whenever Yowkly isn&apos;t open, and as idle after 10 minutes away.</p>
        {MODE_OPTIONS.map(([value, label, hint]) => (
          <label key={value} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)] has-[:checked]:shadow-[inset_0_0_0_2px_var(--accent)]">
            <input type="radio" name="status_mode" value={value} checked={mode === value} disabled={pending} onChange={() => pickMode(value)} className="sr-only" />
            <StatusDot status={value === 'invisible' ? 'offline' : value} size={12} ring="transparent" />
            <span className="flex flex-col">
              <span className="font-medium">{label}</span>
              <span className="text-[12.5px] text-ink-3">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={isPublic} disabled={pending} onChange={(e) => togglePublic(e.target.checked)} className="mt-1 h-[18px] w-[18px] accent-[var(--accent)]" />
        <span className="flex flex-col">
          <span className="font-medium">Show my friends list on my profile</span>
          <span className="text-[13px] text-ink-3">Friends are people you follow who follow you back. When this is off, only you can see the list.</span>
        </span>
      </label>
    </div>
  );
}
