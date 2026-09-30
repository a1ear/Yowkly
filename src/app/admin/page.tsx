import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { Cover } from '@/components/cover';
import { StatusPill } from '@/components/status-pill';
import { EmptyState } from '@/components/bits';
import { TemplateModActions, ReportActions, PostRemoveAction } from '@/components/admin/mod-actions';
import { SubAdminToggle } from '@/components/admin/sub-admins';
import { Avatar } from '@/components/bits';
import { formatBytes, timeAgo } from '@/lib/format';
import type { TemplateCard } from '@/lib/types';

export const metadata: Metadata = { title: 'Admin panel', robots: { index: false } };

type Candidate = { id: string; username: string; display_name: string; avatar_path: string | null; is_sub_admin: boolean; follows_you: boolean };

export default async function AdminPage(props: PageProps<'/admin'>) {
  const sp = await props.searchParams;
  const db = await userClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) redirect('/auth/sign-in?next=/admin');
  // Server-side role check. Hiding the link is courtesy; this is the gate (and every RPC checks again).
  // Sub-admins ('reviewer') get the review queue only; reports, the audit log and the team are for moderators/admins.
  const { data: role } = await db.rpc('my_staff_role');
  if (!role) notFound();
  const isMod = role === 'admin' || role === 'moderator';
  const isAdmin = role === 'admin';
  const allowed = ['queue', ...(isMod ? ['reports', 'log'] : []), ...(isAdmin ? ['team'] : [])];
  const tab = allowed.includes(String(sp.tab)) ? String(sp.tab) : 'queue';

  const [{ data: queue }, { data: reports }, { data: log }] = await Promise.all([
    db.from('template_cards').select('*').eq('status', 'pending_review').order('created_at'),
    isMod ? db.from('reports').select('id, target_type, target_id, reason, details, created_at, reporter:profiles!reports_reporter_id_fkey(username)')
      .eq('status', 'open').order('created_at').limit(100) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    tab === 'log' ? db.from('moderation_log').select('id, action, target_type, target_id, reason, created_at, actor:profiles!moderation_log_actor_id_fkey(username)')
      .order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
  ]);
  const pending = (queue ?? []) as TemplateCard[];
  const { data: cand } = tab === 'team' ? await db.rpc('sub_admin_candidates') : { data: [] };
  const candidates = (cand ?? []) as Candidate[];
  // Reported posts: show what was said and who said it, so the report can be judged.
  const postIds = (reports ?? []).filter((r) => r.target_type === 'post').map((r) => r.target_id as string);
  const { data: reportedPosts } = postIds.length
    ? await db.from('posts').select('id, body, status, author:profiles!posts_author_id_fkey(username)').in('id', postIds)
    : { data: [] };
  const commentIds = (reports ?? []).filter((r) => r.target_type === 'post_comment').map((r) => r.target_id as string);
  const { data: reportedComments } = commentIds.length
    ? await db.from('post_comments').select('id, body, status, author:profiles!post_comments_author_id_fkey(username)').in('id', commentIds)
    : { data: [] };
  const commentById = new Map(((reportedComments ?? []) as unknown as { id: string; body: string; status: string; author: { username: string } | null }[]).map((c) => [c.id, c]));
  const postById = new Map(((reportedPosts ?? []) as unknown as { id: string; body: string; status: string; author: { username: string } | null }[]).map((p) => [p.id, p]));
  const { data: files } = pending.length
    ? await db.from('template_files').select('template_id, original_name, size_bytes, scan_status, reject_reason').in('template_id', pending.map((p) => p.id))
    : { data: [] };

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-10 md:px-10">
      <h1 className="m-0 font-display text-5xl font-normal">{isMod ? 'Admin panel' : 'Review queue'}</h1>
      {!isMod && <p className="m-0 mt-2 text-ink-2">As a sub-admin you can approve uploads or ask the creator for changes.</p>}
      <nav aria-label="Moderation sections" className="mt-6 flex gap-1 border-b border-line">
        {([['queue', `Review queue (${pending.length})`], ['reports', `Reports (${(reports ?? []).length})`], ['log', 'Audit log'], ['team', 'Sub-admins']] as const)
          .filter(([id]) => allowed.includes(id)).map(([id, label]) => (
          <Link key={id} href={`/admin?tab=${id}`} aria-current={tab === id ? 'page' : undefined}
                className="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-ink-2 aria-[current=page]:border-accent aria-[current=page]:text-ink">{label}</Link>
        ))}
      </nav>

      <div className="mt-8">
        {tab === 'queue' && (pending.length === 0 ? <EmptyState title="Queue is clear" /> : (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {pending.map((t) => (
              <li key={t.id} className="grid gap-4 rounded-xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] md:grid-cols-[200px_1fr_320px]">
                <div className="aspect-[16/10] overflow-hidden rounded-md"><Cover seed={t.slug} title={t.title} coverPath={t.cover_path} kind={t.category_kind} /></div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="font-semibold">{t.title}</span>
                  <span className="text-[13px] text-ink-2">@{t.owner_username} · {t.category_name} · {t.license_code} · submitted {timeAgo(t.created_at)}</span>
                  {t.tagline && <span className="text-[13px] text-ink-3">{t.tagline}</span>}
                  <ul className="m-0 mt-1 list-none p-0 font-mono text-[12px] text-ink-2">
                    {(files ?? []).filter((f) => f.template_id === t.id).map((f) => (
                      <li key={f.original_name}>{f.original_name} · {formatBytes(Number(f.size_bytes))} · scan: {f.scan_status}</li>
                    ))}
                  </ul>
                </div>
                <TemplateModActions id={t.id} status={t.status} canRemove={isMod} />
              </li>
            ))}
          </ul>
        ))}

        {tab === 'team' && (
          <section aria-labelledby="team-title" className="flex flex-col gap-4">
            <div>
              <h2 id="team-title" className="m-0 text-lg font-semibold">Sub-admins</h2>
              <p className="m-0 text-[13px] text-ink-2">Pick from people who follow you. Sub-admins can approve uploads or ask for changes. They can&apos;t remove templates, see reports or the audit log, or add other sub-admins.</p>
            </div>
            {candidates.length === 0 ? <EmptyState title="No followers yet" body="When people follow you, you can make them sub-admins here." /> : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {candidates.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-xl bg-surface-1 p-3 shadow-[inset_0_0_0_1px_var(--line)]">
                    <Avatar name={c.display_name} path={c.avatar_path} seed={c.username} size={40} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Link href={`/@${c.username}`} className="truncate font-semibold hover:text-accent-ink">{c.display_name}</Link>
                      <span className="truncate text-[13px] text-ink-3">@{c.username}{c.is_sub_admin ? ' · Sub-admin' : ''}{!c.follows_you ? ' · no longer follows you' : ''}</span>
                    </span>
                    <SubAdminToggle userId={c.id} on={c.is_sub_admin} canGrant={c.follows_you} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'reports' && ((reports ?? []).length === 0 ? <EmptyState title="No open reports" /> : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {(reports ?? []).map((r) => (
              <li key={r.id as string} className="flex flex-col gap-2 rounded-xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)]">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[11px] uppercase">{r.reason as string}</span>
                  <span>{r.target_type as string} <span className="font-mono text-ink-3">{(r.target_id as string).slice(0, 8)}</span></span>
                  <span className="text-ink-3">by @{(r.reporter as unknown as { username: string } | null)?.username ?? 'deleted'} · {timeAgo(r.created_at as string)}</span>
                </div>
                {r.details && <p className="m-0 text-ink-2">{r.details as string}</p>}
                {r.target_type === 'post' && (() => {
                  const post = postById.get(r.target_id as string);
                  return post ? (
                    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
                      <p className="m-0 text-[13px] text-ink-3">Post by @{post.author?.username ?? 'deleted'}{post.status === 'removed' ? ' · already removed' : ''}</p>
                      <p className="m-0 break-words whitespace-pre-line">{post.body}</p>
                      {post.status === 'published' && <PostRemoveAction id={post.id} />}
                    </div>
                  ) : <p className="m-0 text-ink-3">The post no longer exists.</p>;
                })()}
                {r.target_type === 'post_comment' && (() => {
                  const c = commentById.get(r.target_id as string);
                  return c ? (
                    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
                      <p className="m-0 text-[13px] text-ink-3">Comment by @{c.author?.username ?? 'deleted'}{c.status === 'removed' ? ' · already removed' : ''}</p>
                      <p className="m-0 break-words whitespace-pre-line">{c.body}</p>
                      {c.status === 'published' && <PostRemoveAction id={c.id} kind="comment" />}
                    </div>
                  ) : <p className="m-0 text-ink-3">The comment no longer exists.</p>;
                })()}
                <ReportActions id={r.id as string} />
              </li>
            ))}
          </ul>
        ))}

        {tab === 'log' && (
          <div className="overflow-x-auto rounded-xl shadow-[inset_0_0_0_1px_var(--line)]">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Moderation audit log (read-only)</caption>
              <thead className="text-[12px] text-ink-3"><tr className="border-b border-line">
                {['When', 'Who', 'Action', 'Target', 'Reason'].map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {(log ?? []).map((l) => (
                  <tr key={l.id as number} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-ink-2">{timeAgo(l.created_at as string)}</td>
                    <td className="px-4 py-2.5">@{(l.actor as unknown as { username: string } | null)?.username ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono">{l.action as string}</td>
                    <td className="px-4 py-2.5 font-mono text-ink-3">{l.target_type as string}:{(l.target_id as string).slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-ink-2">{(l.reason as string) ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-6 text-[12px] text-ink-3">Status legend: <StatusPill status="pending_review" /> <StatusPill status="removed" /></p>
    </div>
  );
}
