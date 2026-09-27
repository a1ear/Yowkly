import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { ProfileForm, DangerZone } from '@/components/settings-forms';

export const metadata: Metadata = { title: 'Settings', robots: { index: false } };

export default async function SettingsPage() {
  const db = await userClient();
  const { data: claims } = await db.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) redirect('/auth/sign-in?next=/settings');
  const { data: p } = await db.from('profiles')
    .select('username, display_name, bio, location, website, github, x_handle, skills, available_for_hire, hide_likes')
    .eq('id', uid).single();
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10">
      <h1 className="m-0 font-display text-5xl font-normal">Settings</h1>
      <section aria-labelledby="profile-h" className="mt-10">
        <h2 id="profile-h" className="m-0 mb-5 text-lg font-semibold">Profile</h2>
        <ProfileForm profile={p as Parameters<typeof ProfileForm>[0]['profile']} />
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
