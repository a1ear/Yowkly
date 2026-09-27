import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getDraft } from '@/lib/data/draft';
import { getCategories, getLicenses, getTagsByType } from '@/lib/data/public';
import { userClient } from '@/lib/supabase/clients';
import { Stepper, STEPS } from '@/components/upload/stepper';
import { BasicsForm } from '@/components/upload/basics-form';
import { SourceStep } from '@/components/upload/source-step';
import { MediaStep } from '@/components/upload/media-step';
import { LicenseForm } from '@/components/upload/license-form';
import { PublishForm } from '@/components/upload/publish-form';
import { NewVersion } from '@/components/upload/new-version';
import { TemplateCard } from '@/components/template-card';
import { Icon } from '@/components/icons';
import type { TemplateCard as Card, Tool } from '@/lib/types';

export const metadata: Metadata = { title: 'Upload', robots: { index: false } };

const HEADINGS = ['What are you sharing?', 'Where does your template live?', 'Show it off.', 'License & version', 'Looks ready to ship?'];

export default async function UploadStepPage(props: PageProps<'/upload/[id]'>) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const step = Math.min(Math.max(Number(sp.step) || 1, 1), STEPS.length);
  const d = await getDraft(id);
  if (!d) {
    const db = await userClient();
    const { data } = await db.auth.getClaims();
    if (!data?.claims?.sub) redirect(`/auth/sign-in?next=/upload/${id}`);
    notFound();
  }
  const { template: t, draft } = d;
  const [categories, tags, licenses] = await Promise.all([getCategories(), getTagsByType(), getLicenses()]);
  const category = categories.find((c) => c.id === t.category_id);
  const isMobile = category?.kind === 'mobile';

  const clean = d.files.filter((f) => f.scan_status === 'clean').length;
  const scanning = d.files.filter((f) => f.scan_status === 'pending' || f.scan_status === 'scanning').length;
  const rejected = d.files.filter((f) => f.scan_status === 'infected' || f.scan_status === 'rejected').length;
  const cover = d.media.find((m) => m.kind === 'cover');
  const hasSource = d.files.length > 0 || d.links.length > 0 || Boolean(t.demo_url);
  const checks: { ok: boolean; label: string; optional?: boolean; step: number }[] = [
    { ok: Boolean(t.title && t.category_id), label: 'Title and category', step: 1 },
    { ok: hasSource && scanning === 0 && rejected === 0, step: 2,
      label: rejected ? `${rejected} file${rejected > 1 ? 's' : ''} rejected by the scan: remove before publishing`
        : scanning ? `${scanning} file${scanning > 1 ? 's' : ''} still being scanned`
        : hasSource ? `${clean} file${clean === 1 ? '' : 's'} scanned clean${d.links.length ? `, ${d.links.length} link${d.links.length > 1 ? 's' : ''}` : ''}` : 'Add a file, a link or a demo URL' },
    { ok: Boolean(cover), label: cover ? `Cover + ${d.media.length - 1} more image${d.media.length === 2 ? '' : 's'}, all with alt text` : 'Add a cover image', step: 3 },
    { ok: Boolean(draft?.license_code), label: draft?.license_code ? `${draft.license_code} license · v${draft.version}` : 'Choose a license', step: 4 },
    { ok: Boolean(t.demo_url), optional: true, label: t.demo_url ? 'Live demo URL added' : 'Optional: add a demo URL for the live preview', step: 2 },
  ];
  const ready = checks.every((c) => c.ok || c.optional);
  const done = [checks[0].ok, checks[1].ok, checks[2].ok, checks[3].ok, false];

  const db = await userClient();
  const { data: me } = await db.from('profiles').select('trust_level').eq('id', d.uid).single();

  const needsVersion = !draft && [2, 4, 5].includes(step);
  const preview: Card = {
    id: t.id, slug: t.slug, title: t.title, tagline: t.tagline, cover_path: cover?.path ?? null, status: t.status,
    published_at: null, created_at: new Date().toISOString(), owner_id: d.uid, owner_username: 'you', owner_display_name: 'You',
    owner_avatar_path: null, category_id: t.category_id, category_slug: category?.slug ?? null, category_name: category?.name ?? null,
    category_kind: category?.kind ?? null, parent_category_slug: null, like_count: 0, download_count: 0, save_count: 0,
    comment_count: 0, view_count: 0, vote_count: 0, score: null, hot_score: 0, version: draft?.version ?? null,
    license_code: draft?.license_code ?? null, allows_commercial: null, tag_slugs: [],
    tags: tags.filter((g) => d.tagIds.includes(g.id)), tools: [...new Set([...d.files.map((f) => f.source_tool), ...d.links.map((l) => l.kind as Tool)])], award: null,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 md:px-0">
      <div className="flex items-center justify-between gap-4">
        <Stepper step={step} templateId={t.id} done={done} />
        <Link href="/dashboard" className="shrink-0 text-[13px] text-ink-2 hover:text-accent-ink max-md:hidden">Save &amp; exit</Link>
      </div>
      <span className="eyebrow mt-8 block">{STEPS[step - 1]}</span>
      <h1 className="m-0 mt-1 mb-8 font-display text-5xl font-normal">{HEADINGS[step - 1]}</h1>

      {t.status === 'removed' ? (
        <div role="alert" className="rounded-xl bg-surface-1 p-6 shadow-[inset_0_0_0_1px_var(--line)]">
          <p className="m-0 font-semibold text-danger">This template was removed by a moderator.</p>
          {t.status_reason && <p className="m-0 mt-1 text-ink-2">Reason: {t.status_reason}</p>}
          <p className="m-0 mt-3 text-[13px] text-ink-3">If you think this is a mistake, reply to the removal email to appeal.</p>
        </div>
      ) : (
        <>
          {t.status_reason && t.status === 'draft' && (
            <p role="alert" className="mb-6 rounded-md bg-surface-2 p-3 text-[13px] text-warning">A moderator asked for changes: {t.status_reason}</p>
          )}
          {step === 1 && (
            <BasicsForm templateId={t.id} categories={categories} tags={tags}
              initial={{ title: t.title, tagline: t.tagline ?? '', description: t.description ?? '', categoryId: t.category_id, tagIds: d.tagIds }} />
          )}
          {needsVersion && <NewVersion templateId={t.id} latest={d.latestPublished?.version ?? null} step={step} />}
          {step === 2 && draft && <SourceStep templateId={t.id} versionId={draft.id} uid={d.uid} files={d.files} links={d.links} demoUrl={t.demo_url} />}
          {step === 3 && <MediaStep templateId={t.id} uid={d.uid} media={d.media} isMobile={isMobile} />}
          {step === 4 && draft && (
            <LicenseForm templateId={t.id} versionId={draft.id} licenses={licenses} previous={d.latestPublished?.version ?? null}
              initial={{ license: draft.license_code, version: draft.version, changelog: draft.changelog }} />
          )}
          {step === 5 && draft && (
            <div className="flex flex-col gap-8">
              <div className="grid gap-8 md:grid-cols-[320px_1fr]">
                <div className="flex flex-col gap-2">
                  <span className="eyebrow">Card preview</span>
                  <TemplateCard t={preview} />
                </div>
                <section className="flex flex-col gap-1 rounded-xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
                  <h2 className="m-0 mb-2 text-sm font-semibold">Checklist</h2>
                  <ul className="m-0 list-none p-0">
                    {checks.map((c) => (
                      <li key={c.label} className="flex min-h-10 items-center gap-2.5 text-[13.5px]">
                        <span className={c.ok ? 'text-success' : c.optional ? 'text-warning' : 'text-danger'}>
                          <Icon name={c.ok ? 'check' : c.optional ? 'alert' : 'x'} size={17} strokeWidth={2.2} />
                        </span>
                        <span className={c.ok ? 'text-ink-2' : 'text-ink'}>{c.label}</span>
                        {!c.ok && <Link href={`/upload/${t.id}?step=${c.step}`} className="ml-auto text-[12px] text-accent-ink underline-offset-4 hover:underline">Fix</Link>}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
              <PublishForm templateId={t.id} versionId={draft.id} ready={ready} reviewed={(me?.trust_level ?? 0) === 0 && t.status === 'draft'} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
