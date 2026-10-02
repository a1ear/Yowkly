import { Bar, Loading, SkeletonPost } from '@/components/skeletons';

export default function CommunityLoading() {
  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-4 pt-6 pb-16 md:px-6 xl:grid-cols-[280px_minmax(0,760px)_280px] xl:justify-center">
      <Loading label="Loading posts" />
      <div aria-hidden="true" className="hidden flex-col gap-3 xl:flex">
        <Bar className="h-11 w-full" />
        {[0, 1, 2, 3].map((i) => <Bar key={i} className="h-9 w-full" />)}
      </div>
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
        <Bar className="h-[76px] w-full rounded-2xl" />
        <SkeletonPost />
        <SkeletonPost image />
        <SkeletonPost />
      </div>
      <div aria-hidden="true" className="hidden flex-col gap-3 xl:flex">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex items-center gap-3"><Bar className="h-9 w-9 rounded-full" /><Bar className="h-3.5 w-28" /></div>)}
      </div>
    </div>
  );
}
