import { Loading, SkeletonCardGrid, SkeletonHeading } from '@/components/skeletons';

/** Shown while any page loads, until that page has its own skeleton. */
export default function LoadingPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      <Loading />
      <SkeletonHeading />
      <div className="mt-10"><SkeletonCardGrid count={8} cols="sm:grid-cols-2 lg:grid-cols-4" /></div>
    </div>
  );
}
