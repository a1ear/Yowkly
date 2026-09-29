'use client';
import { useActionState } from 'react';
import { completeOnboarding, updateInterests } from '@/app/actions/profile';
import { Icon } from './icons';
import { keepFormOnSubmit } from '@/lib/use-kept-form';

type Props = {
  categories: { id: number; name: string }[];
  tags: { id: number; name: string; type: string }[];
  selectedCategories: number[];
  selectedTags: number[];
};

const tile = 'flex min-h-12 cursor-pointer items-center gap-2 rounded-lg px-4 text-sm text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] transition-colors has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:checked]:shadow-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent';

function Choices({ categories, tags, selectedCategories, selectedTags }: Props) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
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
    </>
  );
}

/** First-run version: pick interests once, then straight to the feed. */
export function OnboardingInterests(props: Props) {
  const [state, action, pending] = useActionState(completeOnboarding, null);
  return (
    <form action={action} onSubmit={keepFormOnSubmit(action)} className="mt-10 flex flex-col gap-6">
      <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
        <legend className="mb-1 text-lg font-semibold">What do you want to see?</legend>
        <p className="m-0 -mt-2 text-[13px] text-ink-3">Pick at least 3. You can change these later in Settings.</p>
        <Choices {...props} />
      </fieldset>
      {state?.error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{state.error}</p>}
      <button className="btn btn-primary btn-lg self-start" disabled={pending}>{pending ? 'Saving…' : 'Finish and see my feed'}</button>
    </form>
  );
}

/** Settings version: change interests any time. */
export function SettingsInterests(props: Props) {
  const [state, action, pending] = useActionState(updateInterests, null);
  return (
    <form action={action} onSubmit={keepFormOnSubmit(action)} className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
        <legend className="sr-only">Interests</legend>
        <Choices {...props} />
      </fieldset>
      {state?.error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{state.error}</p>}
      {state?.ok && <p role="status" className="m-0 flex items-center gap-2 text-success"><Icon name="check" size={16} />Saved. Your For You feed now follows these.</p>}
      <button className="btn btn-primary self-start" disabled={pending}>{pending ? 'Saving…' : 'Save interests'}</button>
    </form>
  );
}
