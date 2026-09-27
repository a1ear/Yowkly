'use client';
import Link from 'next/link';
import { useMe } from './header-account';
import { Icon } from './icons';

/** Only for signed-out visitors. Rendered client-side so the page stays cacheable. */
export function SignupBand() {
  const me = useMe();
  if (me !== null) return null;
  return (
    <section className="mx-auto mt-16 max-w-[1440px] px-4 md:px-10" aria-labelledby="signup-band">
      <div className="flex flex-col items-start gap-5 rounded-2xl bg-surface-1 p-8 shadow-[inset_0_0_0_1px_var(--line)] md:flex-row md:items-center md:justify-between md:p-12">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">For creators</span>
          <h2 id="signup-band" className="m-0 font-display text-4xl leading-none font-normal md:text-5xl">
            Publish your work. Get voted. <em className="text-accent-ink">Get hired.</em>
          </h2>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link href="/auth/sign-in?provider=github" className="btn btn-primary btn-lg"><Icon name="github" size={18} />Continue with GitHub</Link>
          <Link href="/auth/sign-up" className="btn btn-secondary btn-lg">Sign up with email</Link>
        </div>
      </div>
    </section>
  );
}
