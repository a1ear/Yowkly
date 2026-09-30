'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Dialog } from './dialog';
import { Icon } from './icons';

export type FilterGroup = {
  key: 'category' | 'tag' | 'tool'; legend: string; options: [string, string][];
  /** One choice (radio) instead of many. */ single?: boolean;
  /** Only in the More filters popup. */ moreOnly?: boolean;
};

const VISIBLE = 10;

/**
 * Pick filters first, then apply them. The sidebar shows the first 10 options
 * of each group; "More filters" opens every option in a popup that has its own
 * Apply button. Nothing reloads until Apply is pressed. Without JavaScript the
 * form is a plain GET and still works.
 */
export function ExploreFilters({ base, groups, initial, q, sort }: {
  base: string;
  groups: FilterGroup[];
  initial: { category: string; tag: string[]; tool: string[]; commercial: boolean };
  q?: string;
  sort?: string;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(initial.category);
  const [tag, setTag] = useState<string[]>(initial.tag);
  const [tool, setTool] = useState<string[]>(initial.tool);
  const [commercial, setCommercial] = useState(initial.commercial);
  const [more, setMore] = useState(false);

  const pending = category !== initial.category || commercial !== initial.commercial
    || [...tag].sort().join() !== [...initial.tag].sort().join() || [...tool].sort().join() !== [...initial.tool].sort().join();
  const count = (category ? 1 : 0) + tag.length + tool.length + (commercial ? 1 : 0);

  const apply = () => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (sort && sort !== 'trending') qs.set('sort', sort);
    if (category && base === '/explore') qs.set('category', category);
    if (tag.length) qs.set('tag', tag.join(','));
    if (tool.length) qs.set('tool', tool.join(','));
    if (commercial) qs.set('commercial', '1');
    setMore(false);
    router.push(qs.size ? `${base}?${qs}` : base);
  };
  const reset = () => { setCategory(''); setTag([]); setTool([]); setCommercial(false); };

  const toggle = (key: 'tag' | 'tool', value: string) => {
    const set = key === 'tag' ? setTag : setTool;
    set((list) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]));
  };
  const isOn = (g: FilterGroup, value: string) => (g.key === 'category' ? category === value : (g.key === 'tag' ? tag : tool).includes(value));

  // Plain render helpers (not components) so checkboxes keep focus between renders.
  // Only the sidebar copy carries `name`, so a no-JS submit sends each value once.
  const group = (g: FilterGroup, limit?: number) => {
    const shown = limit ? g.options.slice(0, limit) : g.options;
    const name = limit ? g.key : undefined;
    return (
      <fieldset key={g.legend} className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="eyebrow mb-2">{g.legend}</legend>
        {g.single && (
          <label className="flex min-h-9 items-center gap-2.5 text-ink-2">
            <input type="radio" name={name} value="" checked={!category} onChange={() => setCategory('')} className="h-4 w-4 accent-[var(--accent)]" />All
          </label>
        )}
        {shown.map(([value, label]) => (
          <label key={value} className="flex min-h-9 items-center gap-2.5 text-ink-2">
            <input type={g.single ? 'radio' : 'checkbox'} name={name} value={value} checked={isOn(g, value)}
                   onChange={() => (g.single ? setCategory(value) : toggle(g.key as 'tag' | 'tool', value))}
                   className="h-4 w-4 accent-[var(--accent)]" />
            {label}
          </label>
        ))}
      </fieldset>
    );
  };
  const license = (named: boolean) => (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className="eyebrow mb-2">License</legend>
      <label className="flex min-h-9 items-center gap-2.5 text-ink-2">
        <input type="checkbox" name={named ? 'commercial' : undefined} value="1" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
        Commercial use allowed
      </label>
    </fieldset>
  );
  const sidebar = groups.filter((g) => g.options.length && !g.moreOnly);
  const all = groups.filter((g) => g.options.length);
  const hidden = groups.reduce((n, g) => n + (g.moreOnly ? g.options.length : Math.max(0, g.options.length - VISIBLE)), 0);
  const applyLabel = pending ? `Apply filters${count ? ` (${count})` : ''}` : 'Apply filters';

  return (
    <form action={base} method="get" aria-label="Filters" onSubmit={(e) => { e.preventDefault(); apply(); }}
          className="flex flex-col gap-6 max-lg:rounded-xl max-lg:bg-surface-1 max-lg:p-4 max-lg:shadow-[inset_0_0_0_1px_var(--line)]">
      {q && <input type="hidden" name="q" value={q} />}
      {sort && sort !== 'trending' && <input type="hidden" name="sort" value={sort} />}
      <details open className="group flex flex-col gap-6 lg:contents">
        <summary className="flex h-11 cursor-pointer list-none items-center justify-between font-semibold lg:hidden">
          <span className="inline-flex items-center gap-2"><Icon name="filter" size={16} />Filters{count ? ` (${count})` : ''}</span>
          <Icon name="chevronDown" size={16} className="transition group-open:rotate-180" />
        </summary>
        {sidebar.map((g) => group(g, VISIBLE))}
        {license(true)}
        <div className="flex flex-col gap-2 lg:sticky lg:bottom-0 lg:-mx-2 lg:border-t lg:border-line lg:bg-canvas lg:px-2 lg:pt-3 lg:pb-4">
          <button type="submit" disabled={!pending} className="btn btn-primary disabled:opacity-60">{applyLabel}</button>
          <button type="button" onClick={() => setMore(true)} className="btn btn-secondary">
            <Icon name="filter" size={16} />More filters{hidden > 0 ? ` (+${hidden})` : ''}
          </button>
          {count > 0 && <button type="button" onClick={reset} className="btn btn-ghost h-9 text-[13px]">Clear selection</button>}
        </div>
      </details>

      <Dialog open={more} onClose={() => setMore(false)} title="All filters" width={720}>
        <div className="flex max-h-[60vh] flex-col gap-6 overflow-y-auto pr-1">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {all.map((g) => group(g))}
            {license(false)}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <button type="button" onClick={reset} className="btn btn-ghost">Clear all</button>
          <button type="button" onClick={apply} className="btn btn-primary">{count ? `Apply filters (${count})` : 'Apply filters'}</button>
        </div>
      </Dialog>
    </form>
  );
}
