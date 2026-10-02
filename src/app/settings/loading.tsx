import { Bar, Loading } from '@/components/skeletons';

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10">
      <Loading label="Loading settings" />
      <Bar className="h-12 w-48" />
      <div className="mt-10 flex flex-col gap-4">{Array.from({ length: 7 }, (_, i) => <span key={i} className="flex flex-col gap-1.5"><Bar className="h-3.5 w-24" /><Bar className="h-11 w-full" /></span>)}</div>
    </div>
  );
}
