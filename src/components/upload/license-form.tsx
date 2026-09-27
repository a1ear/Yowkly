'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { saveLicense } from '@/app/actions/upload';
import { Icon } from '../icons';
import type { License } from '@/lib/types';

export function LicenseForm({ templateId, versionId, licenses, initial, previous }: {
  templateId: string; versionId: string; licenses: License[];
  initial: { license: string | null; version: string; changelog: string | null }; previous: string | null;
}) {
  const [state, action, pending] = useActionState(saveLicense.bind(null, templateId, versionId), null);
  return (
    <form action={action} className="flex flex-col gap-8">
      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-lg font-semibold">License</legend>
        <p className="m-0 -mt-1 text-[13px] text-ink-2">This is what people are allowed to do with your work. It is saved with this version and can&apos;t be changed after publishing; a new version can use a different license.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {licenses.map((l) => (
            <label key={l.code} className="flex cursor-pointer flex-col gap-2 rounded-xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] has-[:checked]:shadow-[inset_0_0_0_2px_var(--accent)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
              <span className="flex items-center gap-2.5">
                <input type="radio" name="license" value={l.code} required defaultChecked={initial.license === l.code} className="h-4 w-4 accent-[var(--accent)]" />
                <span className="font-semibold">{l.name}</span>
              </span>
              <span className="text-[13px] text-ink-2">{l.summary}</span>
              <span className="flex gap-3 text-[12px] text-ink-3">
                <span>{l.allows_commercial ? '✓ Commercial use' : '✕ No commercial use'}</span>
                <span>{l.requires_attribution ? 'Credit required' : 'No credit needed'}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <label className="flex flex-col gap-1.5">
          <span className="label">Version</span>
          <input name="version" required defaultValue={initial.version} pattern="\d{1,4}\.\d{1,4}\.\d{1,4}" className="field font-mono" aria-describedby="version-hint" />
          <span id="version-hint" className="text-[12px] text-ink-3">{previous ? `Must be higher than v${previous}.` : 'Semantic versioning, e.g. 1.0.0'}</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">What&apos;s in this version</span>
          <textarea name="changelog" rows={3} maxLength={5000} defaultValue={initial.changelog ?? ''} className="field h-auto py-2.5" placeholder="First release." />
        </label>
      </div>
      {state?.error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{state.error}</p>}
      <div className="sticky bottom-16 flex justify-between gap-2 border-t border-line bg-canvas/95 py-4 md:bottom-0">
        <Link href={`/upload/${templateId}?step=3`} className="btn btn-ghost">Back</Link>
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Continue to Review'}<Icon name="arrowRight" size={16} /></button>
      </div>
    </form>
  );
}
