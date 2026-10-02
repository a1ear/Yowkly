import { Bar, Loading, SkeletonCardGrid } from '@/components/skeletons';

export default function ProfileLoading() {
  return (
    <div className="mx-auto max-w-[1200px] md:px-6 md:pt-6">
      <Loading label="Loading profile" />
      <div className="overflow-hidden bg-surface-1 shadow-[inset_0_0_0_1px_var(--line)] md:rounded-2xl">
        <Bar className="h-[160px] w-full rounded-none sm:h-[240px] lg:h-[320px]" />
        <div className="flex items-end gap-5 px-4 pb-6 md:px-8">
          <Bar className="-mt-14 h-28 w-28 rounded-full ring-4 ring-[var(--surface-1)] md:-mt-20 md:h-40 md:w-40" />
          <span className="flex flex-col gap-2 pb-2"><Bar className="h-10 w-56" /><Bar className="h-4 w-72 max-w-full" /></span>
        </div>
        <div className="flex gap-4 border-t border-line px-6 py-3">{[0, 1, 2, 3].map((i) => <Bar key={i} className="h-5 w-20" />)}</div>
      </div>
      <div className="mt-5 grid gap-5 px-4 md:px-0 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Bar className="h-72 w-full rounded-2xl" />
        <SkeletonCardGrid count={6} />
      </div>
    </div>
  );
}
