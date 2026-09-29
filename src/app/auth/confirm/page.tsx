import type { Metadata } from 'next';
import Link from 'next/link';
import { confirmEmail } from '@/app/actions/auth';
import { Icon } from '@/components/icons';

export const metadata: Metadata = { title: 'Confirm your email', robots: { index: false } };

/** Where the link in the sign-up email lands. One click confirms the address. */
export default async function ConfirmPage(props: PageProps<'/auth/confirm'>) {
  const sp = await props.searchParams;
  const tokenHash = typeof sp.token_hash === 'string' ? sp.token_hash : '';
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-accent-ink shadow-[inset_0_0_0_1px_var(--line)]">
          <Icon name="mail" size={22} strokeWidth={2} />
        </span>
        <h1 className="m-0 mt-2 font-display text-[44px] leading-none font-normal md:text-5xl">Confirm your email.</h1>
        <p className="m-0 text-ink-2">One click and your account is ready, with 100 yowkbits waiting.</p>
      </div>
      {tokenHash ? (
        <form action={confirmEmail}>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <button className="btn btn-primary btn-lg w-full">Confirm my email</button>
        </form>
      ) : (
        <p role="alert" className="m-0 rounded-md bg-surface-2 p-3 text-[13px] text-danger">
          This link is incomplete. Open the newest email from Yowkly, or <Link href="/auth/sign-in" className="underline">sign in</Link> to request a new one.
        </p>
      )}
    </div>
  );
}
