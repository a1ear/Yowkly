import { Bar, Loading } from '@/components/skeletons';

export default function CategoriesLoading() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      <Loading label="Loading categories" />
      <Bar className="h-12 w-60" />
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Bar key={i} className="h-48 rounded-xl" />)}</div>
    </div>
  );
}
