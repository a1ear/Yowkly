import { Bar, Loading, SkeletonHeading, SkeletonRows } from '@/components/skeletons';

export default function RankingLoading() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      <Loading label="Loading the ranking" />
      <SkeletonHeading />
      <Bar className="mt-8 h-[360px] w-full rounded-2xl" />
      <div className="mt-10 grid gap-6 lg:grid-cols-2"><SkeletonRows count={5} /><SkeletonRows count={5} /></div>
    </div>
  );
}
