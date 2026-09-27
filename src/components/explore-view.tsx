import Link from 'next/link';
import { exploreTemplates, getCategories, getTagsByType, SORTS, type ExploreParams } from '@/lib/data/public';
import { TemplateCard } from './template-card';
import { EmptyState } from './bits';
import { Icon } from './icons';
import { AutoSubmit } from './auto-submit';
import { formatCount } from '@/lib/format';
import { TOOL_LABEL } from '@/lib/labels';
import type { Tool } from '@/lib/types';

const TOOLS: Tool[] = ['figma', 'code', 'canva', 'psd', 'sketch', 'ai', 'penpot', 'xd', 'github', 'framer', 'webflow'];

function href(base: string, p: ExploreParams, patch: Partial<Record<keyof ExploreParams, unknown>>) {
  const next = { ...p, page: 1, ...patch } as Record<string, unknown>;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    if (k === 'category' && base !== '/explore') continue;
    if (Array.isArray(v)) { if (v.length) qs.set(k, v.join(',')); }
    else if (v != null && v !== '' && !(k === 'sort' && v === 'trending') && !(k === 'page' && v === 1)) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

export async function ExploreView({ params, base, title, description }: {
  params: ExploreParams; base: string; title: string; description?: string | null;
}) {
  const [{ rows, total, hasMore }, categories, tags] = await Promise.all([
    exploreTemplates(params), getCategories(), getTagsByType(),
  ]);
  const top = categories.filter((c) => !c.parent_id);
  const stacks = tags.filter((t) => t.type === 'stack');
  const styles = tags.filter((t) => t.type === 'style');
  const tagName = new Map(tags.map((t) => [t.slug, t.name]));

  const active: [string, string][] = [
    ...(params.category && base === '/explore' ? [[categories.find((c) => c.slug === params.category)?.name ?? params.category, href(base, params, { category: undefined })] as [string, string]] : []),
    ...params.tag.map((t) => [tagName.get(t) ?? t, href(base, params, { tag: params.tag.filter((x) => x !== t) })] as [string, string]),
    ...params.tool.map((t) => [TOOL_LABEL[t], href(base, params, { tool: params.tool.filter((x) => x !== t) })] as [string, string]),
    ...(params.commercial ? [['Commercial use', href(base, params, { commercial: undefined })] as [string, string]] : []),
    ...(params.q ? [[`“${params.q}”`, href(base, params, { q: undefined })] as [string, string]] : []),
  ];

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 md:px-10">
      <div className="flex flex-col gap-1.5">
        <nav aria-label="Breadcrumb" className="text-[13px] text-ink-3">
          <Link href="/explore" className="hover:text-accent-ink">Explore</Link>
          {base !== '/explore' && <> / <span className="text-ink-2">{title}</span></>}
        </nav>
        <h1 className="m-0 font-display text-[44px] leading-none font-normal md:text-[56px]">{params.q ? `Results for “${params.q}”` : title}</h1>
        {description && <p className="m-0 text-ink-2">{description}</p>}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <form action={base} method="get" aria-label="Filters" className="flex flex-col gap-6 max-lg:rounded-xl max-lg:bg-surface-1 max-lg:p-4 max-lg:shadow-[inset_0_0_0_1px_var(--line)]">
          <AutoSubmit />
          {params.q && <input type="hidden" name="q" value={params.q} />}
          {params.sort !== 'trending' && <input type="hidden" name="sort" value={params.sort} />}
          <details open className="group flex flex-col gap-6 lg:contents">
            <summary className="flex h-11 cursor-pointer list-none items-center justify-between font-semibold lg:hidden">
              <span className="inline-flex items-center gap-2"><Icon name="filter" size={16} />Filters{active.length ? ` (${active.length})` : ''}</span>
              <Icon name="chevronDown" size={16} className="transition group-open:rotate-180" />
            </summary>
            {base === '/explore' && (
              <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
                <legend className="eyebrow mb-2">Category</legend>
                <label className="flex min-h-9 items-center gap-2.5 text-ink-2"><input type="radio" name="category" value="" defaultChecked={!params.category} className="h-4 w-4 accent-[var(--accent)]" />All</label>
                {top.map((c) => (
                  <label key={c.slug} className="flex min-h-9 items-center gap-2.5 text-ink-2">
                    <input type="radio" name="category" value={c.slug} defaultChecked={params.category === c.slug} className="h-4 w-4 accent-[var(--accent)]" />
                    {c.name}
                  </label>
                ))}
              </fieldset>
            )}
            <CheckGroup legend="Tech stack" name="tag" options={stacks.map((t) => [t.slug, t.name])} selected={params.tag} />
            <CheckGroup legend="Source tool" name="tool" options={TOOLS.map((t) => [t, TOOL_LABEL[t]])} selected={params.tool} />
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="eyebrow mb-2">License</legend>
              <label className="flex min-h-9 items-center gap-2.5 text-ink-2">
                <input type="checkbox" name="commercial" value="1" defaultChecked={Boolean(params.commercial)} className="h-4 w-4 accent-[var(--accent)]" />
                Commercial use allowed
              </label>
            </fieldset>
            <CheckGroup legend="Style" name="tag" options={styles.map((t) => [t.slug, t.name])} selected={params.tag} />
            <button type="submit" className="btn btn-secondary">Apply filters</button>
          </details>
        </form>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Sort" className="flex gap-1 overflow-x-auto rounded-md bg-surface-1 p-1 shadow-[inset_0_0_0_1px_var(--line)]">
              {(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((s) => (
                <Link key={s} href={href(base, params, { sort: s })} aria-current={params.sort === s ? 'page' : undefined}
                      className="inline-flex h-9 items-center rounded-sm px-3 text-[13px] font-medium whitespace-nowrap text-ink-2 hover:text-ink aria-[current=page]:bg-surface-3 aria-[current=page]:text-ink">
                  {SORTS[s]}
                </Link>
              ))}
            </div>
            <span className="font-mono text-xs text-ink-3" aria-live="polite">
              {total > 1000 ? '1,000+' : formatCount(total)} template{total === 1 ? '' : 's'}
            </span>
          </div>

          {active.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {active.map(([label, to]) => (
                <Link key={label + to} href={to} aria-label={`Remove filter ${label}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2 pr-2 pl-3 text-[13px] text-ink hover:bg-surface-3">
                  {label}<Icon name="x" size={14} />
                </Link>
              ))}
              <Link href={base} className="ml-1 text-[13px] text-ink-2 underline-offset-4 hover:underline">Clear all</Link>
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState
              title="No templates match these filters"
              body={active.length ? 'Try removing a filter or two.' : 'Nothing has been published here yet.'}
              action={active.length ? <Link href={base} className="btn btn-secondary">Clear all filters</Link> : <Link href="/upload" className="btn btn-primary">Upload the first one</Link>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((t, i) => <TemplateCard key={t.id} t={t} priority={i < 3} />)}
            </div>
          )}

          {(params.page > 1 || hasMore) && (
            <nav aria-label="Pagination" className="mt-6 flex justify-center gap-3">
              {params.page > 1 && <Link href={href(base, params, { page: params.page - 1 })} className="btn btn-secondary"><Icon name="chevronLeft" size={16} />Previous</Link>}
              {hasMore && <Link href={href(base, params, { page: params.page + 1 })} className="btn btn-secondary">Load more<Icon name="chevronRight" size={16} /></Link>}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckGroup({ legend, name, options, selected }: { legend: string; name: string; options: [string, string][]; selected: string[] }) {
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className="eyebrow mb-2">{legend}</legend>
      {options.map(([value, label]) => (
        <label key={value} className="flex min-h-9 items-center gap-2.5 text-ink-2">
          <input type="checkbox" name={name} value={value} defaultChecked={selected.includes(value)} className="h-4 w-4 accent-[var(--accent)]" />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
