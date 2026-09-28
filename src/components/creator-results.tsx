'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { followStates, setFollow } from '@/app/actions/engagement';
import { Avatar } from './bits';
import { Icon } from './icons';
import { useToast } from './toast';
import { formatCompact, formatCount } from '@/lib/format';
import type { Creator } from '@/lib/types';

type Viewer = { me: string | null; following: Set<string> };

/** Creators matching a search, each with a Follow button. One request loads every follow state. */
export function CreatorResults({ creators, query }: { creators: Creator[]; query: string }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const ids = creators.map((c) => c.id).join(',');

  useEffect(() => {
    let cancelled = false;
    followStates(ids ? ids.split(',') : []).then((r) => {
      if (!cancelled) setViewer({ me: r.me, following: new Set(r.following) });
    });
    return () => { cancelled = true; };
  }, [ids]);

  return (
    <section aria-labelledby="creator-results" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="creator-results" className="m-0 text-lg font-semibold">Creators</h2>
        <span className="font-mono text-xs text-ink-3">{formatCount(creators.length)} match{creators.length === 1 ? '' : 'es'} for “{query}”</span>
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {creators.map((c, i) => (
          <li key={c.id} className="rank-row" style={{ animationDelay: `${i * 40}ms` }}>
            <article className="relative flex items-center gap-3 rounded-xl bg-surface-1 p-3.5 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-surface-2">
              <Avatar name={c.display_name} path={c.avatar_path} seed={c.username} size={48} />
              <div className="flex min-w-0 flex-1 flex-col">
                <Link href={`/@${c.username}`} className="truncate font-semibold after:absolute after:inset-0 after:content-['']">{c.display_name}</Link>
                <span className="truncate text-[13px] text-ink-2">@{c.username}{c.location ? ` · ${c.location}` : ''}</span>
                <span className="truncate font-mono text-[11.5px] text-ink-3">
                  {formatCount(c.template_count)} template{c.template_count === 1 ? '' : 's'} · {formatCompact(c.followers)} follower{c.followers === 1 ? '' : 's'}
                  {c.skills.length > 0 && ` · ${c.skills.slice(0, 2).join(', ')}`}
                </span>
              </div>
              <FollowToggle creator={c} viewer={viewer} onChange={(following) => setViewer((v) => {
                if (!v) return v;
                const next = new Set(v.following);
                if (following) next.add(c.id); else next.delete(c.id);
                return { ...v, following: next };
              })} />
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FollowToggle({ creator, viewer, onChange }: { creator: Creator; viewer: Viewer | null; onChange: (following: boolean) => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  // Sits above the card's stretched link so clicks reach the button.
  const cls = 'relative z-10 btn h-9 shrink-0 px-3.5';
  if (!viewer) return <span className="skeleton relative z-10 h-9 w-[88px] shrink-0" aria-hidden="true" />;
  if (viewer.me === creator.id) return <span className="relative z-10 shrink-0 text-[12.5px] text-ink-3">You</span>;
  if (!viewer.me) {
    return <Link href={`/auth/sign-in?next=${encodeURIComponent(`/@${creator.username}`)}`} className={`${cls} btn-primary`}>Follow</Link>;
  }
  const following = viewer.following.has(creator.id);
  return (
    <button type="button" disabled={pending} aria-pressed={following} aria-label={`${following ? 'Unfollow' : 'Follow'} ${creator.display_name}`}
            className={`${cls} ${following ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => start(async () => {
              onChange(!following);
              const r = await setFollow(creator.id, !following);
              if (!r.ok) { onChange(following); toast({ text: r.error, tone: 'error' }); }
              else if (!following) toast({ text: `Following ${creator.display_name}`, tone: 'ok' });
            })}>
      {following ? <><Icon name="check" size={15} />Following</> : 'Follow'}
    </button>
  );
}
