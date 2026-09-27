import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetForm } from '@/components/auth-forms';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } };

export default function ResetPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-5xl font-normal">Reset password</h1>
        <p className="m-0 text-ink-2">We&apos;ll email you a link to choose a new one.</p>
      </div>
      <ResetForm />
      <Link href="/auth/sign-in" className="text-center text-[13px] text-ink-2 hover:text-accent-ink">Back to sign in</Link>
    </div>
  );
}
