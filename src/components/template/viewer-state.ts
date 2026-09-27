'use client';
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';

export type MyVote = { design: number; usability: number; creativity: number; code_quality: number | null; updated_at: string };
export type ViewerState = {
  uid: string | null;
  liked: boolean;
  following: boolean;
  vote: MyVote | null;
  eligibility: 'ok' | 'auth' | 'own' | 'unverified' | 'too_new' | 'not_published';
  licenseAccepted: boolean;
};

/** The viewer's personal state for one template, loaded in the browser (RLS scopes every query to them). */
export function useViewerState(templateId: string, ownerId: string, licenseCode: string | null) {
  const [state, setState] = useState<ViewerState | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = browserClient();
      const { data } = await db.auth.getClaims();
      const uid = (data?.claims?.sub as string | undefined) ?? null;
      if (!uid) {
        if (!cancelled) setState({ uid: null, liked: false, following: false, vote: null, eligibility: 'auth', licenseAccepted: false });
        return;
      }
      const [like, follow, vote, elig, lic] = await Promise.all([
        db.from('likes').select('template_id').eq('template_id', templateId).eq('user_id', uid).maybeSingle(),
        db.from('follows').select('followee_id').eq('follower_id', uid).eq('followee_id', ownerId).maybeSingle(),
        db.from('votes').select('design, usability, creativity, code_quality, updated_at').eq('template_id', templateId).eq('user_id', uid).maybeSingle(),
        db.rpc('vote_eligibility', { p_template: templateId }),
        licenseCode
          ? db.from('license_acceptances').select('license_code').eq('license_code', licenseCode).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setState({
        uid,
        liked: Boolean(like.data),
        following: Boolean(follow.data),
        vote: (vote.data as MyVote | null) ?? null,
        eligibility: (elig.data as ViewerState['eligibility']) ?? 'auth',
        licenseAccepted: Boolean(lic.data),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, ownerId, licenseCode]);
  return [state, setState] as const;
}
