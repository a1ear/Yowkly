import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { publicClient } from '@/lib/supabase/clients';
import { TemplateCard } from '@/components/template-card';
import { EmptyState } from '@/components/bits';
import type { TemplateCard as Card } from '@/lib/types';

export const revalidate = 60;
export const metadata: Metadata = { title: 'Collection' };

// Public collections only. A private one answers 404, same as one that doesn't exist.
export default async function CollectionPage(props: PageProps<'/collections/[id]'>) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = publicClient([`collection:${id}`]);
  const { data: c } = await db.from('collections')
    .select('id, name, description, owner:profiles(username, display_name), collection_items(template_id, created_at)')
    .eq('id', id).maybeSingle();
  if (!c) notFound();
  const col = c as unknown as { name: string; description: string | null; owner: { username: string; display_name: string }; collection_items: { template_id: string }[] };
  const ids = col.collection_items.map((i) => i.template_id);
  const { data } = ids.length ? await db.from('template_cards').select('*').in('id', ids).eq('status', 'published') : { data: [] };
  const cards = (data ?? []) as Card[];
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      <span className="eyebrow">Collection</span>
      <h1 className="m-0 mt-1 font-display text-5xl font-normal">{col.name}</h1>
      <p className="m-0 mt-2 text-ink-2">by <Link href={`/@${col.owner.username}`} className="text-ink hover:text-accent-ink">{col.owner.display_name}</Link> · {cards.length} template{cards.length === 1 ? '' : 's'}</p>
      {col.description && <p className="m-0 mt-2 max-w-2xl text-ink-2">{col.description}</p>}
      <div className="mt-8">
        {cards.length === 0 ? <EmptyState title="Nothing saved here yet" /> : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">{cards.map((t) => <TemplateCard key={t.id} t={t} />)}</div>
        )}
      </div>
    </div>
  );
}
