import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { getCategories, getTagsByType } from '@/lib/data/public';
import { Stepper } from '@/components/upload/stepper';
import { BasicsForm } from '@/components/upload/basics-form';

export const metadata: Metadata = { title: 'Upload a template', robots: { index: false } };

export default async function NewUploadPage() {
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) redirect('/auth/sign-in?next=/upload');
  const [categories, tags] = await Promise.all([getCategories(), getTagsByType()]);
  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 md:px-0">
      <Stepper step={1} templateId={null} done={[false, false, false, false, false]} />
      <h1 className="m-0 mt-8 font-display text-5xl font-normal">What are you sharing?</h1>
      <p className="m-0 mt-2 mb-8 text-ink-2">Start with the basics. Your draft saves at every step, so you can finish later from the dashboard.</p>
      <BasicsForm templateId={null} initial={{ title: '', tagline: '', description: '', categoryId: null, tagIds: [] }} categories={categories} tags={tags} />
    </div>
  );
}
