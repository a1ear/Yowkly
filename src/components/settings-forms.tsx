'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { keepFormOnSubmit } from '@/lib/use-kept-form';
import { updateProfile, deleteAccount } from '@/app/actions/profile';
import Link from 'next/link';
import { Icon } from './icons';
import { SOCIALS, type SocialKey } from '@/lib/social';

type Profile = {
  username: string; display_name: string; bio: string | null; location: string | null; website: string | null;
  skills: string[]; available_for_hire: boolean; hide_likes: boolean;
} & Record<SocialKey, string | null>;

function Text({ label, name, initial, hint, ...rest }: { label: string; name: string; initial?: string | null; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <input name={name} defaultValue={initial ?? ''} className="field" {...rest} />
      {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

/** Everything the form would submit, as one comparable string. */
function snapshot(form: HTMLFormElement) {
  return JSON.stringify([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));
}

export function ProfileForm({ profile: p }: { profile: Profile }) {
  const [state, action, pending] = useActionState(updateProfile, null);
  const formRef = useRef<HTMLFormElement>(null);
  const saved = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const router = useRouter();
  useUnsavedGuard(dirty && !pending);

  // Remember what's saved: on first render, and again after each successful save.
  useEffect(() => {
    if (formRef.current && (saved.current === null || state?.ok)) {
      saved.current = snapshot(formRef.current);
      setDirty(false);
      // Re-read the profile so "Discard" later resets to what was just saved.
      if (state?.ok) router.refresh();
    }
  }, [state, router]);
  const check = () => formRef.current && setDirty(snapshot(formRef.current) !== saved.current);
  const discard = () => {
    formRef.current?.reset();
    setDirty(false);
  };

  return (
    <form ref={formRef} id="profile-form" action={action} onSubmit={keepFormOnSubmit(action)} onInput={check} onChange={check} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="Display name" name="displayName" initial={p.display_name} required maxLength={60} />
        <Text label="Username" name="username" initial={p.username} required pattern="[A-Za-z0-9_]{3,30}" hint="Changing it changes your profile URL." />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">Bio</span>
        <textarea name="bio" defaultValue={p.bio ?? ''} maxLength={500} rows={3} className="field h-auto py-2.5" />
      </label>
      <p className="m-0 flex items-center gap-2 rounded-md bg-surface-1 p-3 text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
        <Icon name="camera" size={16} className="shrink-0" />
        Change your profile photo and cover photo on <Link href={`/@${p.username}`} className="text-accent-ink underline underline-offset-4">your profile</Link>.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="Location" name="location" initial={p.location} maxLength={80} />
        <Text label="Website" name="website" initial={p.website} type="url" placeholder="https://" />
      </div>
      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="label mb-1">Profile links</legend>
        <p className="m-0 -mt-1 text-[12.5px] text-ink-3">Paste a profile link or type your username. Leave blank to hide it.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIALS.map((s) => (
            <label key={s.key} className="flex items-center gap-2.5 rounded-md bg-surface-1 pl-3 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_2px_var(--accent)]">
              <Icon name={s.icon} size={17} className="shrink-0 text-ink-2" />
              <span className="sr-only">{s.label}</span>
              <input name={s.key} defaultValue={p[s.key] ?? ''} placeholder={`${s.label} ${s.placeholder}`} maxLength={200} autoComplete="off"
                     className="h-11 min-w-0 flex-1 bg-transparent pr-3 text-sm text-ink outline-none placeholder:text-ink-3" />
            </label>
          ))}
        </div>
      </fieldset>
      <Text label="Skills" name="skills" initial={p.skills.join(', ')} hint="Comma-separated, up to 15." />
      <label className="flex items-center gap-3"><input type="checkbox" name="hire" defaultChecked={p.available_for_hire} className="h-[18px] w-[18px] accent-[var(--accent)]" />Show “Available for hire” on my profile</label>
      <label className="flex items-center gap-3"><input type="checkbox" name="hideLikes" defaultChecked={p.hide_likes} className="h-[18px] w-[18px] accent-[var(--accent)]" />Hide the templates I like from other people</label>
      {state?.error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{state.error}</p>}
      {state?.ok && <p role="status" className="m-0 flex items-center gap-2 text-success"><Icon name="check" size={16} />Saved.</p>}
      <button className="btn btn-primary self-start" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button>

      {dirty && (
        <div role="status" className="rise fixed inset-x-3 bottom-[76px] z-50 mx-auto flex max-w-xl items-center gap-3 rounded-xl bg-surface-2 p-3 pl-4 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-e2)] md:bottom-5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          <span className="flex-1 text-[13.5px] text-ink">You have unsaved changes</span>
          <button type="button" onClick={discard} className="btn btn-ghost h-10 px-3">Discard</button>
          <button type="submit" disabled={pending} className="btn btn-primary h-10">{pending ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}
    </form>
  );
}

export function DangerZone() {
  const [state, action, pending] = useActionState(deleteAccount, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="m-0 text-ink-2">
        Deleting your account unlists your templates and hides your profile immediately. Everything is permanently removed after 30 days.
        People who already downloaded your work keep their copy under the license they accepted.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="label">Type DELETE to confirm</span>
        <input name="confirm" autoComplete="off" className="field max-w-xs" />
      </label>
      {state?.error && <p role="alert" className="m-0 text-danger">{state.error}</p>}
      <button className="btn btn-danger self-start" disabled={pending}>{pending ? 'Deleting…' : 'Delete my account'}</button>
    </form>
  );
}
