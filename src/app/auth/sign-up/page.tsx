import type { Metadata } from 'next';
import Link from 'next/link';
import { SignUpForm } from '@/components/auth-forms';
import { OAuthButtons } from '@/components/oauth-buttons';

export const metadata: Metadata = { title: 'Create an account', robots: { index: false } };

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-5xl font-normal">Publish your work.</h1>
        <p className="m-0 text-ink-2">Get voted. Get hired. Downloads are free with an account.</p>
      </div>
      <OAuthButtons next="/onboarding" />
      <SignUpForm />
      <p className="m-0 text-center text-[13px] text-ink-2">
        Already have an account? <Link href="/auth/sign-in" className="font-medium text-accent-ink underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
