import { Bar, Loading } from '@/components/skeletons';

export default function MessagesLoading() {
  return (
    <div className="mx-auto grid h-[calc(100dvh-64px)] max-w-[1200px] gap-4 px-4 py-5 md:grid-cols-[340px_1fr] md:px-6">
      <Loading label="Loading messages" />
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-1 p-3 shadow-[inset_0_0_0_1px_var(--line)]">
        <Bar className="h-9 w-40" />
        <Bar className="h-10 w-full rounded-full" />
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="flex items-center gap-3 py-1.5"><Bar className="h-11 w-11 rounded-full" /><span className="flex flex-1 flex-col gap-1.5"><Bar className="h-3.5 w-1/2" /><Bar className="h-3 w-3/4" /></span></div>)}
      </div>
      <div className="hidden flex-col gap-3 rounded-2xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)] md:flex">
        {[0, 1, 2, 3, 4].map((i) => <Bar key={i} className={`h-10 w-1/2 rounded-2xl ${i % 2 ? 'self-end' : ''}`} />)}
      </div>
    </div>
  );
}
