import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { TemplateCard } from '@/components/template-card';
import { EmptyState } from '@/components/bits';
import type { TemplateCard as Card } from '@/lib/types';

export const metadata: Metadata = { title: 'For You', robots: { index: false } };

export default async function ForYouPage(props: PageProps<'/for-you'>) {
  const sp = await props.searchParams;
  const tab = sp.tab === 'following' ? 'following' : 'for-you';
  const db = await userClient();
  const { data: claims } = await db.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) redirect('/auth/sign-in?next=/for-you');

  let rows: (Card & { reason?: string })[] = [];
  if (tab === 'for-you') {
    const { data: feed, error } = await db.rpc('for_you', { p_limit: 24, p_offset: 0 });
    if (error) throw new Error(error.message);
    const items = (feed ?? []) as { template_id: string; reason: string }[];
    if (items.length) {
      const { data } = await db.from('template_cards').select('*').in('id', items.map((f) => f.template_id));
      const byId = new Map(((data ?? []) as Card[]).map((c) => [c.id, c]));
      rows = items.flatMap((f) => (byId.get(f.template_id) ? [{ ...byId.get(f.template_id)!, reason: f.reason }] : []));
    }
  } else {
    const { data: follows } = await db.from('follows').select('followee_id').eq('follower_id', uid);
    const ids = (follows ?? []).map((f) => f.followee_id as string);
    if (ids.length) {
      const { data } = await db.from('template_cards').select('*').eq('status', 'published').in('owner_id', ids)
        .order('published_at', { ascending: false }).limit(24);
      rows = (data ?? []) as Card[];
    }
  }
  // Only people who never picked interests see the prompt; afterwards interests live in Settings.
  const { data: me } = await db.from('profiles').select('onboarded_at').eq('id', uid).single();
  const needsInterests = !me?.onboarded_at;

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      <h1 className="m-0 font-display text-[56px] leading-none font-normal">For You</h1>
      <nav aria-label="Feed" className="mt-6 flex gap-1 border-b border-line">
        {[['for-you', 'For You', '/for-you'], ['following', 'Following', '/for-you?tab=following']].map(([id, label, href]) => (
          <Link key={id} href={href} aria-current={tab === id ? 'page' : undefined}
                className="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-ink-2 hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink">
            {label}
          </Link>
        ))}
      </nav>

      {tab === 'for-you' && needsInterests && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
          <p className="m-0 text-ink-2">Pick a few interests and this feed gets a lot smarter.</p>
          <Link href="/onboarding" className="btn btn-primary">Choose interests</Link>
        </div>
      )}

      <div className="mt-8">
        {rows.length === 0 ? (
          <EmptyState
            title={tab === 'following' ? 'Nothing from people you follow yet' : 'You’ve seen it all'}
            body={tab === 'following' ? 'Follow creators to see their new work here.' : 'Check back soon, or browse everything.'}
            action={<Link href="/explore" className="btn btn-secondary">Explore templates</Link>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {rows.map((t, i) => (
              <div key={t.id} className="flex flex-col gap-2">
                {t.reason && <span className="font-mono text-[11px] text-ink-3">{t.reason}</span>}
                <TemplateCard t={t} priority={i < 4} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
