'use client';
import { useActionState, useMemo, useState } from 'react';
import { saveBasics } from '@/app/actions/upload';
import { Icon } from '../icons';
import type { Category } from '@/lib/types';

type Tag = { id: number; slug: string; name: string; type: string };

export function BasicsForm({ templateId, initial, categories, tags }: {
  templateId: string | null;
  initial: { title: string; tagline: string; description: string; categoryId: number | null; tagIds: number[] };
  categories: Category[];
  tags: Tag[];
}) {
  const [state, action, pending] = useActionState(saveBasics.bind(null, templateId), null);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const initialCat = initial.categoryId ? byId.get(initial.categoryId) : undefined;
  const [top, setTop] = useState<number | ''>(initialCat ? (initialCat.parent_id ?? initialCat.id) : '');
  const subs = categories.filter((c) => c.parent_id === top);
  const [title, setTitle] = useState(initial.title);
  const [picked, setPicked] = useState<number[]>(initial.tagIds);
  const [query, setQuery] = useState('');
  const suggestions = tags.filter((t) => !picked.includes(t.id) && t.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

  const req = <span className="text-danger" aria-hidden="true"> *</span>;
  return (
    <form action={action} className="flex flex-col gap-6">
      <p className="m-0 -mt-4 text-[13px] text-ink-3">Fields marked <span className="text-danger">*</span> are required.</p>
      <label className="flex flex-col gap-1.5">
        <span className="flex justify-between"><span className="label">Title{req}</span><span className="font-mono text-[11px] text-ink-3">{title.length} / 80</span></span>
        <input name="title" required minLength={3} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} className="field" placeholder="Nocturne — SaaS Dashboard Kit" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Tagline{req}</span>
        <input name="tagline" required minLength={10} maxLength={140} defaultValue={initial.tagline} className="field" placeholder="One sentence that sells it" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label">Category{req}</span>
          <select name="category" required value={top} onChange={(e) => setTop(e.target.value ? Number(e.target.value) : '')} className="field">
            <option value="">Choose…</option>
            {categories.filter((c) => !c.parent_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Subcategory <span className="font-normal text-ink-3">(optional)</span></span>
          <select name="subcategory" defaultValue={initialCat?.parent_id ? initialCat.id : ''} key={String(top)} disabled={!subs.length} className="field disabled:opacity-50">
            <option value="">{subs.length ? 'Any' : '—'}</option>
            {subs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="label mb-1.5">Tags{req} <span className="font-normal text-ink-3">(at least 1, up to 10: stack, tools, style)</span></legend>
        {picked.map((id) => <input key={id} type="hidden" name="tag" value={id} />)}
        <div className="flex flex-wrap gap-2">
          {picked.map((id) => {
            const t = tags.find((x) => x.id === id);
            return (
              <button key={id} type="button" onClick={() => setPicked((p) => p.filter((x) => x !== id))} aria-label={`Remove tag ${t?.name}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2 pr-2 pl-3 text-[13px] hover:bg-surface-3">
                {t?.name}<Icon name="x" size={13} />
              </button>
            );
          })}
        </div>
        {picked.length < 10 && (
          <>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tags (React, Figma, Minimal…)" aria-label="Search tags" className="field" />
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((t) => (
                <button key={t.id} type="button" onClick={() => { setPicked((p) => [...p, t.id]); setQuery(''); }}
                        className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] hover:text-ink">
                  <Icon name="plus" size={12} />{t.name}
                </button>
              ))}
            </div>
          </>
        )}
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="label">Description{req}</span>
        <textarea name="description" required minLength={30} rows={8} maxLength={10000} defaultValue={initial.description} className="field h-auto resize-y py-2.5"
                  placeholder={'What’s included, who it’s for, how to use it.\n\n- Use "- " for bullet points\n- **bold** for emphasis'} />
        <span className="text-[12px] text-ink-3">Plain text with simple formatting: “- ” lists, ## headings, **bold**, `code`.</span>
      </label>

      {state?.error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{state.error}</p>}
      <div className="sticky bottom-16 flex justify-end gap-2 border-t border-line bg-canvas/95 py-4 md:bottom-0">
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save & continue'}<Icon name="arrowRight" size={16} /></button>
      </div>
    </form>
  );
}
