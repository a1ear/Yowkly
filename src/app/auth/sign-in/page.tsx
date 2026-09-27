import type { Metadata } from 'next';
import Link from 'next/link';
import { SignInForm } from '@/components/auth-forms';
import { OAuthButtons } from '@/components/oauth-buttons';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

const ERRORS: Record<string, string> = {
  link: 'That link has expired or was already used. Request a new one.',
  oauth: 'We could not reach the sign-in provider. Try again.',
};

export default async function SignInPage(props: PageProps<'/auth/sign-in'>) {
  const sp = await props.searchParams;
  const next = safeNext(sp.next);
  const error = typeof sp.error === 'string' ? ERRORS[sp.error] : undefined;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-5xl font-normal">Welcome back.</h1>
        <p className="m-0 text-ink-2">Sign in to vote, save and download templates.</p>
      </div>
      {error && <p role="alert" className="m-0 rounded-md bg-surface-2 p-3 text-[13px] text-danger">{error}</p>}
      <OAuthButtons next={next} />
      <SignInForm next={next} />
      <p className="m-0 text-center text-[13px] text-ink-2">
        New here? <Link href="/auth/sign-up" className="font-medium text-accent-ink underline-offset-4 hover:underline">Create an account</Link>
      </p>
    </div>
  );
}
