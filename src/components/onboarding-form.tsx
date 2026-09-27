'use client';
import { useActionState } from 'react';
import { completeOnboarding } from '@/app/actions/profile';
import { Icon } from './icons';

export function OnboardingForm({ profile, categories, tags, selectedCategories, selectedTags }: {
  profile: { username: string; display_name: string };
  categories: { id: number; name: string }[];
  tags: { id: number; name: string; type: string }[];
  selectedCategories: number[];
  selectedTags: number[];
}) {
  const [state, action, pending] = useActionState(completeOnboarding, null);
  const tile = 'flex min-h-12 cursor-pointer items-center gap-2 rounded-lg px-4 text-sm text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:checked]:shadow-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent';
  return (
    <form action={action} className="mt-10 flex flex-col gap-10">
      <fieldset className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold">1. Your name</legend>
        <label className="flex flex-col gap-1.5">
          <span className="label">Display name</span>
          <input name="displayName" defaultValue={profile.display_name} required maxLength={60} className="field" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Username</span>
          <span className="flex items-center rounded-md bg-surface-1 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_2px_var(--accent)]">
            <span className="pl-3.5 text-ink-3">@</span>
            <input name="username" defaultValue={profile.username} required pattern="[A-Za-z0-9_]{3,30}" maxLength={30}
                   className="h-11 w-full bg-transparent px-1 text-sm outline-none" />
          </span>
        </label>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
        <legend className="mb-1 text-lg font-semibold">2. What do you want to see?</legend>
        <p className="m-0 -mt-2 text-[13px] text-ink-3">Pick at least 3. You can change these any time.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {categories.map((c) => (
            <label key={c.id} className={tile}>
              <input type="checkbox" name="category" value={c.id} defaultChecked={selectedCategories.includes(c.id)} className="sr-only" />
              {c.name}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <label key={t.id} className={`${tile} min-h-10 rounded-full px-3.5`}>
              <input type="checkbox" name="tag" value={t.id} defaultChecked={selectedTags.includes(t.id)} className="sr-only" />
              {t.name}
            </label>
          ))}
        </div>
      </fieldset>

      {state?.error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{state.error}</p>}
      <button className="btn btn-primary btn-lg self-start" disabled={pending}>{pending ? 'Saving…' : 'Finish and see my feed'}</button>
    </form>
  );
}
