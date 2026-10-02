import { Loading, SkeletonCardGrid, SkeletonHeading } from '@/components/skeletons';

export default function ForYouLoading() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      <Loading label="Loading your feed" />
      <SkeletonHeading />
      <div className="mt-10"><SkeletonCardGrid count={8} cols="sm:grid-cols-2 lg:grid-cols-4" /></div>
    </div>
  );
}
