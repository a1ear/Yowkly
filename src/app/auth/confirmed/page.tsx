import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';

export const metadata: Metadata = { title: 'Email confirmed', robots: { index: false } };

/** Shown after the email is confirmed. /onboarding sends anyone who isn't signed in to sign in first. */
export default function ConfirmedPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-on-accent">
          <Icon name="check" size={22} strokeWidth={2.5} />
        </span>
        <h1 className="m-0 mt-2 font-display text-[44px] leading-none font-normal md:text-5xl">Email confirmed.</h1>
        <p className="m-0 text-ink-2">Welcome to Yowkly. Your 100 yowkbits are in your wallet. Pick a few interests and we&apos;ll set up your feed.</p>
      </div>
      <Link href="/onboarding" className="btn btn-primary btn-lg w-full">Continue</Link>
    </div>
  );
}
