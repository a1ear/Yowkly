import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ExploreView } from '@/components/explore-view';
import { exploreParams, getCategories } from '@/lib/data/public';

async function findCategory(slug: string) {
  return (await getCategories()).find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata(props: PageProps<'/c/[category]'>): Promise<Metadata> {
  const c = await findCategory((await props.params).category);
  return c ? { title: `${c.name} templates`, description: c.description ?? undefined } : {};
}

export default async function CategoryPage(props: PageProps<'/c/[category]'>) {
  const { category } = await props.params;
  const c = await findCategory(category);
  if (!c) notFound();
  const params = exploreParams.parse({ ...(await props.searchParams), category: c.slug });
  return <ExploreView params={params} base={`/c/${c.slug}`} title={c.name} description={c.description} />;
}
