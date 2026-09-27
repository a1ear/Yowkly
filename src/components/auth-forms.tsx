'use client';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { signIn, signUp, sendMagicLink, requestPasswordReset, updatePassword, type AuthState } from '@/app/actions/auth';
import { Icon } from './icons';

function Field({ label, error, ...input }: { label: string; error?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <input className="field" aria-invalid={error || undefined} {...input} />
    </label>
  );
}

function Feedback({ state }: { state: AuthState }) {
  if (state?.error) return <p role="alert" className="m-0 flex items-start gap-2 text-[13px] text-danger"><Icon name="alert" size={16} className="mt-0.5 shrink-0" />{state.error}</p>;
  if (state?.message) return <p role="status" className="m-0 flex items-start gap-2 rounded-md bg-surface-2 p-3 text-[13px] text-ink"><Icon name="mail" size={16} className="mt-0.5 shrink-0 text-success" />{state.message}</p>;
  return null;
}

export function SignInForm({ next }: { next: string }) {
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [pwState, pwAction, pwPending] = useActionState(signIn, null);
  const [linkState, linkAction, linkPending] = useActionState(sendMagicLink, null);
  if (mode === 'link') {
    return (
      <form action={linkAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={linkState?.email} error={Boolean(linkState?.error)} />
        <Feedback state={linkState} />
        <button className="btn btn-primary btn-lg" disabled={linkPending}>{linkPending ? 'Sending…' : 'Email me a sign-in link'}</button>
        <button type="button" onClick={() => setMode('password')} className="btn btn-ghost">Use a password instead</button>
      </form>
    );
  }
  return (
    <form action={pwAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={pwState?.email} error={Boolean(pwState?.error)} />
      <div className="flex flex-col gap-1.5">
        <Field label="Password" name="password" type="password" autoComplete="current-password" required error={Boolean(pwState?.error)} />
        <Link href="/auth/reset" className="self-end text-[13px] text-ink-2 hover:text-accent-ink">Forgot password?</Link>
      </div>
      <Feedback state={pwState} />
      <button className="btn btn-primary btn-lg" disabled={pwPending}>{pwPending ? 'Signing in…' : 'Sign in'}</button>
      <button type="button" onClick={() => setMode('link')} className="btn btn-ghost">Email me a link instead</button>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUp, null);
  if (state?.message) return <Feedback state={state} />;
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
      <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} aria-describedby="pw-hint" />
      <p id="pw-hint" className="-mt-2 m-0 text-[12.5px] text-ink-3">At least 10 characters, with a letter and a number.</p>
      <label className="flex items-start gap-2.5 text-[13px] text-ink-2">
        <input type="checkbox" name="terms" required className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[var(--accent)]" />
        <span>I agree to the <Link href="/legal/terms" className="text-accent-ink underline">Terms</Link> and <Link href="/legal/privacy" className="text-accent-ink underline">Privacy Policy</Link>.</span>
      </label>
      <Feedback state={state} />
      <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? 'Creating account…' : 'Create account'}</button>
    </form>
  );
}

export function ResetForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Feedback state={state} />
      <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? 'Sending…' : 'Send reset link'}</button>
    </form>
  );
}

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="New password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      <Feedback state={state} />
      <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? 'Saving…' : 'Save password'}</button>
    </form>
  );
}
