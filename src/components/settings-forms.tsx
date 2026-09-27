'use client';
import { useActionState } from 'react';
import { updateProfile, deleteAccount } from '@/app/actions/profile';
import { Icon } from './icons';

type Profile = {
  username: string; display_name: string; bio: string | null; location: string | null; website: string | null;
  github: string | null; x_handle: string | null; skills: string[]; available_for_hire: boolean; hide_likes: boolean;
};

function Text({ label, name, initial, hint, ...rest }: { label: string; name: string; initial?: string | null; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <input name={name} defaultValue={initial ?? ''} className="field" {...rest} />
      {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function ProfileForm({ profile: p }: { profile: Profile }) {
  const [state, action, pending] = useActionState(updateProfile, null);
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="Display name" name="displayName" initial={p.display_name} required maxLength={60} />
        <Text label="Username" name="username" initial={p.username} required pattern="[A-Za-z0-9_]{3,30}" hint="Changing it changes your profile URL." />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">Bio</span>
        <textarea name="bio" defaultValue={p.bio ?? ''} maxLength={500} rows={3} className="field h-auto py-2.5" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="Location" name="location" initial={p.location} maxLength={80} />
        <Text label="Website" name="website" initial={p.website} type="url" placeholder="https://" />
        <Text label="GitHub username" name="github" initial={p.github} maxLength={39} />
        <Text label="X handle" name="x" initial={p.x_handle} maxLength={16} />
      </div>
      <Text label="Skills" name="skills" initial={p.skills.join(', ')} hint="Comma-separated, up to 15." />
      <label className="flex items-center gap-3"><input type="checkbox" name="hire" defaultChecked={p.available_for_hire} className="h-[18px] w-[18px] accent-[var(--accent)]" />Show “Available for hire” on my profile</label>
      <label className="flex items-center gap-3"><input type="checkbox" name="hideLikes" defaultChecked={p.hide_likes} className="h-[18px] w-[18px] accent-[var(--accent)]" />Hide the templates I like from other people</label>
      {state?.error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{state.error}</p>}
      {state?.ok && <p role="status" className="m-0 flex items-center gap-2 text-success"><Icon name="check" size={16} />Saved.</p>}
      <button className="btn btn-primary self-start" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button>
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
