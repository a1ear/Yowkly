import type { Metadata } from 'next';
import Link from 'next/link';
import { getCategories, getFeaturedTags } from '@/lib/data/public';

export const revalidate = 3600;
export const metadata: Metadata = { title: 'Categories', description: 'Browse Yowkly by category.' };

export default async function CategoriesPage() {
  const [categories, featured] = await Promise.all([getCategories(), getFeaturedTags()]);
  const top = categories.filter((c) => !c.parent_id);
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      <h1 className="m-0 font-display text-[56px] leading-none font-normal">Categories</h1>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {top.map((c) => {
          const subs = categories.filter((s) => s.parent_id === c.id);
          return (
            <section key={c.id} className="flex flex-col gap-3 rounded-xl bg-surface-1 p-6 shadow-[inset_0_0_0_1px_var(--line)]">
              <h2 className="m-0 font-display text-3xl font-normal"><Link href={`/c/${c.slug}`} className="hover:text-accent-ink">{c.name}</Link></h2>
              {c.description && <p className="m-0 text-ink-2">{c.description}</p>}
              {(featured.get(c.id) ?? []).length > 0 && (
                <ul aria-label={`Popular in ${c.name}`} className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {featured.get(c.id)!.map((t) => <li key={t.slug}><Link href={`/c/${c.slug}?tag=${t.slug}`} className="chip-tool h-8 px-3 text-[13px] hover:text-accent-ink">{t.name}</Link></li>)}
                </ul>
              )}
              {subs.length > 0 && (
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {subs.map((s) => <li key={s.id}><Link href={`/c/${s.slug}`} className="filter-chip h-8 px-3 text-[13px]">{s.name}</Link></li>)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
