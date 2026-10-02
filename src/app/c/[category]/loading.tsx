import { Bar, Loading, SkeletonCardGrid, SkeletonHeading } from '@/components/skeletons';

export default function ExploreLoading() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 md:px-10">
      <Loading label="Loading templates" />
      <SkeletonHeading eyebrow={false} />
      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <div aria-hidden="true" className="hidden flex-col gap-3 lg:flex">
          {Array.from({ length: 12 }, (_, i) => <Bar key={i} className={i % 6 === 0 ? 'mt-3 h-3 w-20' : 'h-5 w-40'} />)}
        </div>
        <div className="flex flex-col gap-5">
          <div className="flex justify-between"><Bar className="h-10 w-80 max-w-full" /><Bar className="h-4 w-24" /></div>
          <SkeletonCardGrid count={9} />
        </div>
      </div>
    </div>
  );
}
