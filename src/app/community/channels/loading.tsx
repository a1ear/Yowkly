import { Bar, Loading, SkeletonHeading } from '@/components/skeletons';

export default function ChannelsLoading() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-8 pb-16 md:px-6">
      <Loading label="Loading channels" />
      <SkeletonHeading eyebrow={false} />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }, (_, i) => <Bar key={i} className="h-32 rounded-2xl" />)}</div>
    </div>
  );
}
