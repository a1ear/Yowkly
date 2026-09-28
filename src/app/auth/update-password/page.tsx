import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { UpdatePasswordForm } from '@/components/auth-forms';
import { userClient } from '@/lib/supabase/clients';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

export default async function UpdatePasswordPage() {
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) redirect('/auth/reset');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="m-0 font-display text-[44px] leading-none font-normal md:text-5xl">Choose a new password</h1>
      <UpdatePasswordForm />
    </div>
  );
}
