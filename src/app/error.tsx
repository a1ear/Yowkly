'use client';
import { useEffect } from 'react';
import { Icon } from '@/components/icons';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Sentry picks this up once SENTRY_DSN is configured (see docs/OPERATIONS.md).
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-5 px-4 py-24">
      <span className="text-danger"><Icon name="alert" size={28} /></span>
      <h1 className="m-0 font-display text-5xl leading-none font-normal">Couldn&apos;t load this page</h1>
      <p className="m-0 text-ink-2">The server took too long to answer or something broke on our side. Your filters and drafts are safe.</p>
      {error.digest && <p className="m-0 font-mono text-xs text-ink-3">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className="btn btn-primary"><Icon name="refresh" size={16} />Try again</button>
    </div>
  );
}
