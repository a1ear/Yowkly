import { Bar, Loading } from '@/components/skeletons';

export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-10 md:px-10">
      <Loading label="Loading the admin panel" />
      <Bar className="h-12 w-64" />
      <div className="mt-6 flex gap-3 border-b border-line pb-3">{Array.from({ length: 6 }, (_, i) => <Bar key={i} className="h-5 w-24" />)}</div>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Bar key={i} className="h-24 rounded-xl" />)}</div>
    </div>
  );
}
