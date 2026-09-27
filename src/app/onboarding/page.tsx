import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { getCategories, getTagsByType } from '@/lib/data/public';
import { OnboardingForm } from '@/components/onboarding-form';

export const metadata: Metadata = { title: 'Welcome', robots: { index: false } };

export default async function OnboardingPage() {
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) redirect('/auth/sign-in?next=/onboarding');
  const [{ data: profile }, categories, tags, { data: ic }, { data: it }] = await Promise.all([
    db.from('profiles').select('username, display_name').eq('id', uid).single(),
    getCategories(),
    getTagsByType(),
    db.from('user_interest_categories').select('category_id'),
    db.from('user_interest_tags').select('tag_id'),
  ]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <span className="eyebrow">Welcome to Yowkly</span>
      <h1 className="m-0 mt-2 font-display text-5xl font-normal">Let&apos;s set you up.</h1>
      <p className="m-0 mt-2 text-ink-2">Choose how you appear, then pick what you want to see more of.</p>
      <OnboardingForm
        profile={profile as { username: string; display_name: string }}
        categories={categories.filter((c) => !c.parent_id).map((c) => ({ id: c.id, name: c.name }))}
        tags={tags.filter((t) => t.type === 'stack' || t.type === 'style').map((t) => ({ id: t.id, name: t.name, type: t.type }))}
        selectedCategories={(ic ?? []).map((r) => r.category_id as number)}
        selectedTags={(it ?? []).map((r) => r.tag_id as number)}
      />
    </div>
  );
}
