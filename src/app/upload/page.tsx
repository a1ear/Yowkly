import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { getCategories, getTagsByType } from '@/lib/data/public';
import { Stepper } from '@/components/upload/stepper';
import { BasicsForm } from '@/components/upload/basics-form';
import { Icon } from '@/components/icons';

export const metadata: Metadata = { title: 'Upload a template', robots: { index: false } };

export default async function NewUploadPage() {
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) redirect('/auth/sign-in?next=/upload');
  const [categories, tags, slotsRes] = await Promise.all([getCategories(), getTagsByType(), db.rpc('my_template_slots')]);
  // The database enforces the limit (create_template); this only explains it up front.
  const slots = (slotsRes.data as { used: number; max: number; unlimited: boolean }[] | null)?.[0];
  const full = slots && !slots.unlimited && slots.used >= slots.max;
  if (full) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-accent-ink"><Icon name="grid" size={22} /></span>
        <h1 className="m-0 font-display text-5xl leading-none font-normal">You&apos;ve used all {slots.max} template slots</h1>
        <p className="m-0 text-ink-2">
          Each account can have up to {slots.max} templates, so every one gets the attention it deserves. Delete a draft to free a slot,
          or publish a new version of an existing template instead (versions don&apos;t count).
        </p>
        <Link href="/dashboard" className="btn btn-primary">Go to your dashboard</Link>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 md:px-0">
      <Stepper step={1} templateId={null} done={[false, false, false, false, false]} />
      <h1 className="m-0 mt-8 font-display text-5xl font-normal">What are you sharing?</h1>
      <p className="m-0 mt-2 text-ink-2">Start with the basics. Your draft saves at every step, so you can finish later from the dashboard.</p>
      {slots && !slots.unlimited && (
        <p className="m-0 mt-3 mb-8 inline-flex items-center gap-2 font-mono text-[12.5px] text-ink-3">
          <span className="inline-flex gap-1" aria-hidden="true">
            {Array.from({ length: slots.max }, (_, i) => <span key={i} className={`h-1.5 w-4 rounded-full ${i < slots.used ? 'bg-accent' : 'bg-surface-3'}`} />)}
          </span>
          {slots.used} of {slots.max} templates used
        </p>
      )}
      {(!slots || slots.unlimited) && <div className="mb-8" />}
      <BasicsForm templateId={null} initial={{ title: '', tagline: '', description: '', categoryId: null, tagIds: [] }} categories={categories} tags={tags} />
    </div>
  );
}
