'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { startNewVersion } from '@/app/actions/upload';
import { Icon } from '../icons';

function bump(v: string | null) {
  if (!v) return '1.0.0';
  const [a, b] = v.split('.').map(Number);
  return `${a}.${b + 1}.0`;
}

/** Published versions are immutable, so changing files means starting a new version. */
export function NewVersion({ templateId, latest, step }: { templateId: string; latest: string | null; step: number }) {
  const router = useRouter();
  const [version, setVersion] = useState(bump(latest));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-1 p-6 shadow-[inset_0_0_0_1px_var(--line)]">
      <h2 className="m-0 text-lg font-semibold">Start a new version</h2>
      <p className="m-0 text-ink-2">
        {latest ? `v${latest} is published and can't be changed, so everyone keeps exactly what they downloaded.` : 'This template has no draft version.'}{' '}
        Files, license and changelog go into a new version.
      </p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await startNewVersion(templateId, version);
          if (!r.ok) return setError(r.error);
          router.push(`/upload/${templateId}?step=${step}`);
          router.refresh();
        });
      }}>
        <label className="flex flex-col gap-1.5">
          <span className="label">Version</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} className="field w-40 font-mono" pattern="\d{1,4}\.\d{1,4}\.\d{1,4}" required />
        </label>
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Creating…' : 'Create draft version'}</button>
      </form>
      {error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{error}</p>}
    </div>
  );
}
