import { Bar, Loading, SkeletonPost } from '@/components/skeletons';

export default function ChannelLoading() {
  return (
    <div className="mx-auto grid max-w-[1200px] gap-6 px-4 pt-6 pb-16 md:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Loading label="Loading channel" />
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4"><Bar className="h-14 w-14 rounded-2xl" /><span className="flex flex-col gap-2"><Bar className="h-9 w-64" /><Bar className="h-4 w-80 max-w-full" /></span></div>
        <Bar className="h-[76px] w-full rounded-2xl" />
        <SkeletonPost />
        <SkeletonPost />
      </div>
      <div className="flex flex-col gap-5"><Bar className="h-32 w-full rounded-2xl" /><Bar className="h-40 w-full rounded-2xl" /></div>
    </div>
  );
}
