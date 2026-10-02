/**
 * Gray placeholder shapes shown while a page loads (route `loading.tsx` files).
 * They mirror the real layout so nothing jumps when the content arrives.
 * Hidden from screen readers; a single status line announces the wait instead.
 */
export function Bar({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} />;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <span role="status" className="sr-only">{label}…</span>;
}

export function SkeletonCard({ tall = false }: { tall?: boolean }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <Bar className={`${tall ? 'aspect-[9/14]' : 'aspect-[16/10]'} w-full rounded-lg`} />
      <Bar className="h-4 w-3/4" />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2"><Bar className="h-5 w-5 rounded-full" /><Bar className="h-3.5 w-24" /></span>
        <Bar className="h-3.5 w-20" />
      </div>
      <div className="flex gap-1.5"><Bar className="h-5 w-12 rounded-full" /><Bar className="h-5 w-14 rounded-full" /></div>
    </div>
  );
}

export function SkeletonCardGrid({ count = 6, cols = 'sm:grid-cols-2 xl:grid-cols-3' }: { count?: number; cols?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-x-6 gap-y-9 ${cols}`}>
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export function SkeletonPost({ image = false }: { image?: boolean }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 rounded-2xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] md:p-5">
      <div className="flex items-center gap-3">
        <Bar className="h-10 w-10 rounded-full" />
        <span className="flex flex-col gap-1.5"><Bar className="h-3.5 w-32" /><Bar className="h-3 w-24" /></span>
      </div>
      <Bar className="h-3.5 w-full" />
      <Bar className="h-3.5 w-5/6" />
      {image && <Bar className="aspect-[16/9] w-full rounded-xl" />}
      <div className="flex gap-3 border-t border-line pt-3"><Bar className="h-6 w-12" /><Bar className="h-6 w-12" /><Bar className="h-6 w-12" /></div>
    </div>
  );
}

export function SkeletonRows({ count = 5, avatar = true }: { count?: number; avatar?: boolean }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl bg-surface-1 p-3 shadow-[inset_0_0_0_1px_var(--line)]">
          {avatar && <Bar className="h-10 w-10 rounded-full" />}
          <span className="flex flex-1 flex-col gap-1.5"><Bar className="h-3.5 w-1/3" /><Bar className="h-3 w-1/2" /></span>
          <Bar className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonHeading({ eyebrow = true }: { eyebrow?: boolean }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      {eyebrow && <Bar className="h-3 w-24" />}
      <Bar className="h-11 w-72 max-w-full" />
      <Bar className="h-4 w-96 max-w-full" />
    </div>
  );
}
