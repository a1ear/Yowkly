'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { publishVersion } from '@/app/actions/upload';
import { Icon } from '../icons';

export function PublishForm({ templateId, versionId, ready, reviewed }: { templateId: string; versionId: string; ready: boolean; reviewed: boolean }) {
  const [state, action, pending] = useActionState(publishVersion.bind(null, templateId, versionId), null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex items-start gap-3 rounded-xl p-4 shadow-[inset_0_0_0_2px_var(--accent)]">
        <input type="checkbox" name="attest" required className="mt-0.5 h-[22px] w-[22px] shrink-0 accent-[var(--accent)]" />
        <span>I own the rights to this work, including every image and font in it, and I&apos;m allowed to share it under the license I chose.</span>
      </label>
      {reviewed && (
        <p className="m-0 flex items-start gap-2.5 rounded-md bg-surface-2 p-3 text-[13px] text-ink-2">
          <Icon name="eye" size={17} className="mt-0.5 shrink-0 text-info" />
          Your first 2 uploads are reviewed by a moderator, usually within 24 h. We&apos;ll notify you when it&apos;s live.
        </p>
      )}
      {state?.error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{state.error}</p>}
      <div className="sticky bottom-16 flex justify-between gap-2 border-t border-line bg-canvas/95 py-4 md:bottom-0">
        <Link href={`/upload/${templateId}?step=4`} className="btn btn-ghost">Back</Link>
        <button className="btn btn-primary btn-lg" disabled={!ready || pending}>
          <Icon name="upload" size={17} />{pending ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </form>
  );
}
