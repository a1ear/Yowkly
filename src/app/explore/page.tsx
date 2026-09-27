import type { Metadata } from 'next';
import { ExploreView } from '@/components/explore-view';
import { exploreParams } from '@/lib/data/public';

export const metadata: Metadata = {
  title: 'Explore templates',
  description: 'Browse web templates, mobile app designs, UI kits and components. Filter by stack, source tool and license.',
};

export default async function ExplorePage(props: PageProps<'/explore'>) {
  const params = exploreParams.parse(await props.searchParams);
  return <ExploreView params={params} base="/explore" title="Explore" description="Templates, app designs and kits from the community." />;
}
