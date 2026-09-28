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

/** Password input with a show/hide toggle. */
function PasswordField({ label, error, onValue, ...input }: { label: string; error?: boolean; onValue?: (v: string) => void } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <span className="relative flex">
        <input className="field pr-12" type={shown ? 'text' : 'password'} aria-invalid={error || undefined}
               onChange={(e) => onValue?.(e.target.value)} {...input} />
        <button type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={shown ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-md text-ink-3 hover:text-ink">
          <Icon name={shown ? 'eye' : 'lock'} size={17} key={String(shown)} className="icon-swap" />
        </button>
      </span>
    </label>
  );
}

/** Hidden from people (and screen readers); bots fill it in. See isBot() in actions/auth.ts. */
function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label>Company website<input type="text" name="company_site" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
    </div>
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
      <form action={linkAction} className="relative flex flex-col gap-4">
        <Honeypot />
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
        <PasswordField label="Password" name="password" autoComplete="current-password" required error={Boolean(pwState?.error)} />
        <Link href="/auth/reset" className="self-end text-[13px] text-ink-2 hover:text-accent-ink">Forgot password?</Link>
      </div>
      <Feedback state={pwState} />
      <button className="btn btn-primary btn-lg" disabled={pwPending}>{pwPending ? 'Signing in…' : <>Sign in <Icon name="arrowRight" size={17} /></>}</button>
      <button type="button" onClick={() => setMode('link')} className="btn btn-ghost">Email me a link instead</button>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUp, null);
  const [pw, setPw] = useState('');
  if (state?.message) return <Feedback state={state} />;
  const rules: [boolean, string][] = [
    [pw.length >= 10, '10+ characters'],
    [/[A-Za-z]/.test(pw), 'a letter'],
    [/[0-9]/.test(pw), 'a number'],
  ];
  return (
    <form action={action} className="relative flex flex-col gap-4">
      <Honeypot />
      <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
      <PasswordField label="Password" name="password" autoComplete="new-password" required minLength={10} aria-describedby="pw-hint" onValue={setPw} />
      <ul id="pw-hint" className="-mt-2 m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[12.5px]" aria-label="Password requirements">
        {rules.map(([met, text]) => (
          <li key={text} className={`inline-flex items-center gap-1 transition-colors ${met ? 'text-success' : 'text-ink-3'}`}>
            <Icon name={met ? 'check' : 'x'} size={13} strokeWidth={2.2} />{text}
            <span className="sr-only">{met ? '(done)' : '(missing)'}</span>
          </li>
        ))}
      </ul>
      <label className="flex items-start gap-2.5 text-[13px] text-ink-2">
        <input type="checkbox" name="terms" required className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[var(--accent)]" />
        <span>I agree to the <Link href="/legal/terms" className="text-accent-ink underline">Terms</Link> and <Link href="/legal/privacy" className="text-accent-ink underline">Privacy Policy</Link>.</span>
      </label>
      <Feedback state={state} />
      <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? 'Creating account…' : <>Create account <Icon name="arrowRight" size={17} /></>}</button>
    </form>
  );
}

export function ResetForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null);
  return (
    <form action={action} className="relative flex flex-col gap-4">
      <Honeypot />
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
      <PasswordField label="New password" name="password" autoComplete="new-password" required minLength={10} />
      <PasswordField label="Confirm new password" name="confirm" autoComplete="new-password" required minLength={10} />
      <Feedback state={state} />
      <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? 'Saving…' : 'Save password'}</button>
    </form>
  );
}
