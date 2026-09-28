import Link from 'next/link';
import { Icon } from '@/components/icons';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-5 px-4 py-24 md:py-32">
      <span className="font-mono text-sm text-ink-3">404</span>
      <h1 className="m-0 font-display text-6xl leading-none font-normal">This page got lost in the layers.</h1>
      <p className="m-0 text-ink-2">The link may be old, or the template was removed. Try searching for it instead.</p>
      <form action="/explore" role="search" className="flex w-full gap-2">
        <label htmlFor="nf-search" className="sr-only">Search templates</label>
        <input id="nf-search" name="q" type="search" placeholder="Search templates" className="field" />
        <button className="btn btn-primary"><Icon name="search" size={16} />Search</button>
      </form>
      <div className="flex gap-4 text-[14px]">
        <Link href="/" className="text-accent-ink underline-offset-4 hover:underline">Go home</Link>
        <Link href="/ranking" className="text-ink-2 underline-offset-4 hover:underline">See today&apos;s winner</Link>
      </div>
    </div>
  );
}
