import { Bar, Loading } from '@/components/skeletons';

export default function TemplateLoading() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-6 md:px-10">
      <Loading label="Loading template" />
      <Bar className="mb-5 h-3.5 w-64" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-6">
          <Bar className="aspect-[16/10] w-full rounded-xl" />
          <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Bar key={i} className="aspect-[16/10] rounded-lg" />)}</div>
          <Bar className="h-[420px] w-full rounded-xl" />
        </div>
        <div aria-hidden="true" className="flex flex-col gap-5">
          <Bar className="h-9 w-4/5" />
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-2/3" />
          <div className="flex items-center gap-3"><Bar className="h-10 w-10 rounded-full" /><Bar className="h-4 w-40" /></div>
          <Bar className="h-56 w-full rounded-xl" />
          <Bar className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
