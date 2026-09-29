import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { getCategories, getTagsByType } from '@/lib/data/public';
import { OnboardingInterests } from '@/components/interest-picker';

export const metadata: Metadata = { title: 'Welcome', robots: { index: false } };

/** First-run only: pick interests once. Afterwards they live in Settings. */
export default async function OnboardingPage() {
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) redirect('/auth/sign-in?next=/onboarding');
  const { data: profile } = await db.from('profiles').select('onboarded_at').eq('id', uid).single();
  if (profile?.onboarded_at) redirect('/settings#interests');

  const [categories, tags, { data: ic }, { data: it }] = await Promise.all([
    getCategories(),
    getTagsByType(),
    db.from('user_interest_categories').select('category_id'),
    db.from('user_interest_tags').select('tag_id'),
  ]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <span className="rise eyebrow">Welcome to Yowkly</span>
      <h1 className="rise m-0 mt-2 font-display text-5xl font-normal">Let&apos;s set you up.</h1>
      <p className="rise m-0 mt-2 text-ink-2">Pick what you want to see more of and we&apos;ll build your For You feed around it.</p>
      <OnboardingInterests
        categories={categories.filter((c) => !c.parent_id).map((c) => ({ id: c.id, name: c.name }))}
        tags={tags.filter((t) => t.type === 'stack' || t.type === 'style').map((t) => ({ id: t.id, name: t.name, type: t.type }))}
        selectedCategories={(ic ?? []).map((r) => r.category_id as number)}
        selectedTags={(it ?? []).map((r) => r.tag_id as number)}
      />
    </div>
  );
}
