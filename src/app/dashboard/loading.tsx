import { Bar, Loading, SkeletonHeading, SkeletonRows } from '@/components/skeletons';

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-10 md:px-10">
      <Loading label="Loading your dashboard" />
      <SkeletonHeading />
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Bar key={i} className="h-24 rounded-xl" />)}</div>
      <Bar className="mt-6 h-64 w-full rounded-xl" />
      <div className="mt-10"><SkeletonRows count={4} /></div>
    </div>
  );
}
