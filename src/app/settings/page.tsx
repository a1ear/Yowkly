import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { ProfileForm, DangerZone } from '@/components/settings-forms';
import { SettingsInterests } from '@/components/interest-picker';
import { getCategories, getTagsByType } from '@/lib/data/public';

export const metadata: Metadata = { title: 'Settings', robots: { index: false } };

export default async function SettingsPage() {
  const db = await userClient();
  const { data: claims } = await db.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) redirect('/auth/sign-in?next=/settings');
  const [categories, tags, { data: ic }, { data: it }] = await Promise.all([
    getCategories(), getTagsByType(),
    db.from('user_interest_categories').select('category_id'),
    db.from('user_interest_tags').select('tag_id'),
  ]);
  const { data: p } = await db.from('profiles')
    .select('username, display_name, bio, location, website, github, x_handle, linkedin, dribbble, behance, instagram, youtube, skills, available_for_hire, hide_likes')
    .eq('id', uid).single();
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10">
      <h1 className="m-0 font-display text-5xl font-normal">Settings</h1>
      <section aria-labelledby="profile-h" className="mt-10">
        <h2 id="profile-h" className="m-0 mb-5 text-lg font-semibold">Profile</h2>
        <ProfileForm profile={p as Parameters<typeof ProfileForm>[0]['profile']} />
      </section>
      <section id="interests" aria-labelledby="interests-h" className="mt-14 scroll-mt-28">
        <h2 id="interests-h" className="m-0 mb-1 text-lg font-semibold">Interests</h2>
        <p className="m-0 mb-5 text-[13px] text-ink-3">What your For You feed shows more of. Pick at least 3.</p>
        <SettingsInterests
          categories={categories.filter((c) => !c.parent_id).map((c) => ({ id: c.id, name: c.name }))}
          tags={tags.filter((t) => t.type === 'stack' || t.type === 'style').map((t) => ({ id: t.id, name: t.name, type: t.type }))}
          selectedCategories={(ic ?? []).map((r) => r.category_id as number)}
          selectedTags={(it ?? []).map((r) => r.tag_id as number)}
        />
      </section>
      <section aria-labelledby="account-h" className="mt-14">
        <h2 id="account-h" className="m-0 mb-2 text-lg font-semibold">Account</h2>
        <p className="m-0 text-ink-2">Signed in as <span className="text-ink">{String(claims?.claims?.email ?? '')}</span>. Change your password from <a href="/auth/reset" className="text-accent-ink underline underline-offset-4">reset password</a>.</p>
      </section>
      <section aria-labelledby="danger-h" className="mt-14 rounded-xl p-6 shadow-[inset_0_0_0_1px_var(--danger)]">
        <h2 id="danger-h" className="m-0 mb-2 text-lg font-semibold text-danger">Danger zone</h2>
        <DangerZone />
      </section>
    </div>
  );
}
