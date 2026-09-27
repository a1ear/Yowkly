import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRelated, getTemplateDetail } from '@/lib/data/template';
import { getLicenses } from '@/lib/data/public';
import { Cover } from '@/components/cover';
import { Avatar, AwardRibbon, LicensePill, SectionHeader } from '@/components/bits';
import { TemplateCard } from '@/components/template-card';
import { Icon } from '@/components/icons';
import { SafeMarkdown } from '@/components/safe-markdown';
import { LivePreview } from '@/components/template/live-preview';
import { DetailTabs } from '@/components/template/detail-tabs';
import { Comments } from '@/components/template/comments';
import { ActionRow, DownloadPanel, FollowButton, ViewerProvider, VoteModule } from '@/components/template/panels';
import { displayTools, mediaUrl } from '@/lib/labels';
import { formatBytes, formatLongDate } from '@/lib/format';

export const revalidate = 60;

export async function generateMetadata(props: PageProps<'/t/[slug]'>): Promise<Metadata> {
  const d = await getTemplateDetail((await props.params).slug);
  if (!d) return { title: 'Template not found' };
  const { card } = d;
  return {
    title: card.title,
    description: card.tagline ?? `${card.title} by ${card.owner_display_name} on Yowkly.`,
    alternates: { canonical: `/t/${card.slug}` },
    openGraph: {
      title: card.title,
      description: card.tagline ?? undefined,
      type: 'article',
      images: card.cover_path ? [{ url: mediaUrl(card.cover_path) }] : undefined,
    },
    robots: card.status === 'unlisted' ? { index: false, follow: false } : undefined,
  };
}

export default async function TemplatePage(props: PageProps<'/t/[slug]'>) {
  const { slug } = await props.params;
  const d = await getTemplateDetail(slug);
  if (!d) notFound();
  const { card } = d;
  const [related, licenses] = await Promise.all([getRelated(card), getLicenses()]);
  const gallery = d.media.filter((m) => m.kind !== 'cover');
  const screens = d.media.filter((m) => m.kind === 'mobile_screen');
  const hasCode = card.tools.includes('code') || card.tools.includes('github');
  const currentFiles = d.files.filter((f) => f.version_id === d.currentVersionId);
  const manifest = currentFiles.flatMap((f) => (f.manifest?.entries ?? []).map((e) => ({ ...e, file: f.original_name })));
  const visibleComments = d.comments.filter((c) => !c.deleted_at).length;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: card.title,
    description: card.tagline ?? undefined,
    author: { '@type': 'Person', name: card.owner_display_name, url: `/@${card.owner_username}` },
    datePublished: card.published_at ?? undefined,
    license: d.license?.url ?? undefined,
    version: card.version ?? undefined,
    ...(card.vote_count >= 5 && card.score != null
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: card.score, bestRating: 10, worstRating: 1, ratingCount: card.vote_count } }
      : {}),
  };

  return (
    <ViewerProvider templateId={card.id} ownerId={card.owner_id} slug={card.slug} licenseCode={card.license_code}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div className="mx-auto max-w-[1440px] px-4 pt-6 md:px-10">
        <nav aria-label="Breadcrumb" className="mb-5 text-[13px] text-ink-3">
          <Link href="/explore" className="hover:text-accent-ink">Explore</Link>
          {card.parent_category_slug && <> / <Link href={`/c/${card.parent_category_slug}`} className="hover:text-accent-ink capitalize">{card.parent_category_slug.replace('-', ' ')}</Link></>}
          {card.category_slug && <> / <Link href={`/c/${card.category_slug}`} className="hover:text-accent-ink">{card.category_name}</Link></>}
          {' '}/ <span className="text-ink-2">{card.title}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* Main column */}
          <div className="flex min-w-0 flex-col gap-10">
            <div className="flex flex-col gap-3">
              <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                <Cover seed={card.slug} title={card.title} coverPath={card.cover_path} kind={card.category_kind} priority
                       alt={d.media.find((m) => m.kind === 'cover')?.alt_text} />
              </div>
              {screens.length > 0 && (
                <div aria-label="App screens, scroll horizontally" className="flex gap-3 overflow-x-auto pb-2" tabIndex={0}>
                  {screens.map((m) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={m.id} src={mediaUrl(m.path)} alt={m.alt_text} loading="lazy" className="h-[420px] w-auto rounded-[28px] border-4 border-[#0B0B0A] shadow-e1" />
                  ))}
                </div>
              )}
              {gallery.filter((m) => m.kind === 'gallery').length > 0 && (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {gallery.filter((m) => m.kind === 'gallery').map((m) => (
                    <a key={m.id} href={mediaUrl(m.path)} target="_blank" rel="noopener noreferrer" className="aspect-[16/10] overflow-hidden rounded-md bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={mediaUrl(m.path)} alt={m.alt_text} loading="lazy" className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            <LivePreview url={d.demoUrl} />

            <DetailTabs tabs={[
              { id: 'overview', label: 'Overview', panel: d.description ? <SafeMarkdown text={d.description} /> : <p className="m-0 text-ink-2">No description yet.</p> },
              {
                id: 'files', label: 'Files', count: currentFiles.length,
                panel: currentFiles.length === 0 ? <p className="m-0 text-ink-2">This template is shared as a link. Use the buttons in the download panel.</p> : (
                  <div className="flex flex-col gap-4">
                    {currentFiles.map((f) => (
                      <div key={f.id} className="flex items-center justify-between rounded-md bg-surface-1 px-4 py-3 font-mono text-[13px] shadow-[inset_0_0_0_1px_var(--line)]">
                        <span className="inline-flex items-center gap-2"><Icon name={f.ext === 'zip' ? 'folder' : 'file'} size={16} />{f.original_name}</span>
                        <span className="text-ink-3">{formatBytes(Number(f.size_bytes))} · scanned clean</span>
                      </div>
                    ))}
                    {manifest.length > 0 && (
                      <ul aria-label="Archive contents" className="m-0 list-none rounded-md bg-surface-1 p-4 font-mono text-[12.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
                        {manifest.slice(0, 200).map((e) => (
                          <li key={e.file + e.path} className="flex justify-between gap-4 py-0.5">
                            <span className="truncate">{e.path}</span><span className="shrink-0 text-ink-3">{formatBytes(e.size)}</span>
                          </li>
                        ))}
                        {manifest.length > 200 && <li className="pt-1 text-ink-3">…and {manifest.length - 200} more files</li>}
                      </ul>
                    )}
                  </div>
                ),
              },
              {
                id: 'versions', label: 'Versions', count: d.versions.length,
                panel: (
                  <ol className="m-0 flex list-none flex-col gap-5 border-l border-line p-0 pl-5">
                    {d.versions.map((v) => (
                      <li key={v.id} className="relative flex flex-col gap-1">
                        <span className={`absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full ${v.id === d.currentVersionId ? 'bg-accent' : 'bg-surface-3'}`} aria-hidden="true" />
                        <div className="flex flex-wrap items-center gap-2 text-[13px]">
                          <span className={`font-mono font-medium ${v.status === 'yanked' ? 'text-ink-3 line-through' : ''}`}>v{v.version}</span>
                          {v.published_at && <span className="text-ink-3">{formatLongDate(v.published_at)}</span>}
                          {v.id === d.currentVersionId && <span className="rounded-xs bg-accent px-1.5 py-0.5 font-mono text-[10px] text-on-accent">LATEST</span>}
                          {v.status === 'yanked' && <span className="rounded-xs bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-warning">YANKED</span>}
                        </div>
                        <p className="m-0 text-ink-2">{v.status === 'yanked' ? `Pulled: ${v.yank_reason}` : v.changelog ?? 'No changelog.'}</p>
                      </li>
                    ))}
                  </ol>
                ),
              },
              { id: 'comments', label: 'Comments', count: visibleComments, panel: <Comments templateId={card.id} slug={card.slug} ownerId={card.owner_id} comments={d.comments} /> },
            ]} />
          </div>

          {/* Aside */}
          <aside className="flex flex-col gap-5 lg:sticky lg:top-[96px] lg:self-start">
            <div className="flex flex-col gap-3">
              {card.award && <div><AwardRibbon award={card.award} /></div>}
              <h1 className="m-0 font-display text-[40px] leading-[1.02] font-normal tracking-[-0.015em]">{card.title}</h1>
              {card.tagline && <p className="m-0 text-[15px] text-ink-2">{card.tagline}</p>}
              <div className="flex flex-wrap items-center gap-[5px]">
                {displayTools(card.tools).map((t) => <span key={t} className="chip-tool">{t}</span>)}
                {card.tags.filter((g) => g.type === 'stack').map((g) => (
                  <Link key={g.slug} href={`/explore?tag=${g.slug}`} className="chip-stack hover:text-ink">{g.name}</Link>
                ))}
                <LicensePill code={card.license_code} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-1 p-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
              <Link href={`/@${card.owner_username}`} className="flex min-w-0 items-center gap-3">
                <Avatar name={card.owner_display_name} path={card.owner_avatar_path} seed={card.owner_username} size={40} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{card.owner_display_name}</span>
                  <span className="truncate text-[13px] text-ink-3">@{card.owner_username}</span>
                </span>
              </Link>
              <FollowButton ownerId={card.owner_id} />
            </div>
            <DownloadPanel versions={d.versions} files={d.files} currentVersionId={d.currentVersionId} licenses={licenses} links={d.links} />
            <ActionRow likeCount={card.like_count} title={card.title} />
            <VoteModule score={card.score} breakdown={d.breakdown} hasCode={hasCode} />
          </aside>
        </div>

        {related.more.length > 0 && (
          <section className="mt-16 flex flex-col gap-5">
            <SectionHeader title={`More from ${card.owner_display_name}`} href={`/@${card.owner_username}`} linkLabel="View profile" />
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
              {related.more.map((t) => <TemplateCard key={t.id} t={t} />)}
            </div>
          </section>
        )}
        {related.similar.length > 0 && (
          <section className="mt-16 flex flex-col gap-5">
            <SectionHeader title="Similar templates" href={card.category_slug ? `/c/${card.category_slug}` : '/explore'} />
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
              {related.similar.map((t) => <TemplateCard key={t.id} t={t} />)}
            </div>
          </section>
        )}
      </div>
    </ViewerProvider>
  );
}
