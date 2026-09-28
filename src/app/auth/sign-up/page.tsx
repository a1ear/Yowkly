import type { Metadata } from 'next';
import Link from 'next/link';
import { SignUpForm } from '@/components/auth-forms';
import { OAuthButtons } from '@/components/oauth-buttons';
import { Icon } from '@/components/icons';

export const metadata: Metadata = { title: 'Create an account', robots: { index: false } };

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Create an account</span>
        <h1 className="m-0 font-display text-[44px] leading-none font-normal md:text-5xl">Join Yowkly.</h1>
        <p className="m-0 text-ink-2">
          Start with <span className="inline-flex items-center gap-1 font-mono text-accent-ink"><Icon name="bit" size={14} strokeWidth={2} />100 yowkbits</span> to
          vote for the work you love. Publishing and downloads are free.
        </p>
      </div>
      <OAuthButtons next="/onboarding" />
      <SignUpForm />
      <p className="m-0 text-center text-[13px] text-ink-2">
        Already have an account? <Link href="/auth/sign-in" className="font-medium text-accent-ink underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
