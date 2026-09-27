'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { setFollow } from '@/app/actions/engagement';
import { useToast } from './toast';
import { Icon } from './icons';

export function ProfileFollow({ userId, username }: { userId: string; username: string }) {
  const toast = useToast();
  const [state, setState] = useState<{ me: string | null; following: boolean } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    (async () => {
      const db = browserClient();
      const { data } = await db.auth.getClaims();
      const me = (data?.claims?.sub as string) ?? null;
      if (!me) return setState({ me: null, following: false });
      const { data: f } = await db.from('follows').select('followee_id').eq('follower_id', me).eq('followee_id', userId).maybeSingle();
      setState({ me, following: Boolean(f) });
    })();
  }, [userId]);

  if (!state) return <span className="skeleton h-11 w-28" />;
  if (state.me === userId) return <Link href="/settings" className="btn btn-secondary"><Icon name="settings" size={16} />Edit profile</Link>;
  if (!state.me) return <Link href={`/auth/sign-in?next=/@${username}`} className="btn btn-primary">Follow</Link>;
  return (
    <button type="button" disabled={pending} aria-pressed={state.following}
            className={`btn ${state.following ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => start(async () => {
              const next = !state.following;
              setState({ ...state, following: next });
              const r = await setFollow(userId, next);
              if (!r.ok) { setState({ ...state, following: !next }); toast({ text: r.error, tone: 'error' }); }
            })}>
      {state.following ? <><Icon name="check" size={16} />Following</> : 'Follow'}
    </button>
  );
}
