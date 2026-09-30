import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { Cover } from '@/components/cover';
import { StatusPill } from '@/components/status-pill';
import { EmptyState } from '@/components/bits';
import { TemplateModActions, ReportActions, PostRemoveAction } from '@/components/admin/mod-actions';
import { SubAdminToggle } from '@/components/admin/sub-admins';
import { UserAdminActions } from '@/components/admin/user-actions';
import { Avatar } from '@/components/bits';
import { formatBytes, formatCount, timeAgo } from '@/lib/format';
import type { TemplateCard } from '@/lib/types';

export const metadata: Metadata = { title: 'Admin panel', robots: { index: false } };

type Candidate = { id: string; username: string; display_name: string; avatar_path: string | null; is_sub_admin: boolean; is_friend: boolean; follows_you: boolean; you_follow: boolean };
type AdminUser = {
  id: string; username: string; display_name: string; email: string; avatar_path: string | null; created_at: string;
  last_seen_at: string | null; roles: string[]; trust_level: number; template_count: number; suspended: boolean; suspended_reason: string | null;
};
type Overview = Record<'users' | 'users_7d' | 'online_now' | 'suspended' | 'published' | 'pending' | 'drafts' | 'removed'
  | 'open_reports' | 'scan_queue' | 'scan_rejected_7d' | 'downloads_7d' | 'votes_7d' | 'posts_7d', number>;

const TABS: { id: string; label: string; who: 'reviewer' | 'mod' | 'admin' }[] = [
  { id: 'overview', label: 'Overview', who: 'mod' },
  { id: 'queue', label: 'Review queue', who: 'reviewer' },
  { id: 'reports', label: 'Reports', who: 'mod' },
  { id: 'templates', label: 'Templates', who: 'mod' },
  { id: 'users', label: 'Users', who: 'admin' },
  { id: 'scans', label: 'Scans', who: 'mod' },
  { id: 'log', label: 'Audit log', who: 'mod' },
  { id: 'team', label: 'Sub-admins', who: 'admin' },
];
const STATUSES = ['all', 'published', 'pending_review', 'unlisted', 'draft', 'removed'] as const;

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
  const tabs = TABS.filter((t) => t.who === 'reviewer' || (t.who === 'mod' && isMod) || (t.who === 'admin' && isAdmin));
  const allowed = tabs.map((t) => t.id);
  const tab = allowed.includes(String(sp.tab)) ? String(sp.tab) : isMod ? 'overview' : 'queue';
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 80) : '';
  const status = (STATUSES as readonly string[]).includes(String(sp.status)) ? String(sp.status) : 'all';

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
  const { data: ov } = tab === 'overview' ? await db.rpc('admin_overview') : { data: null };
  const overview = ov as Overview | null;
  const { data: us } = tab === 'users' ? await db.rpc('admin_users', { p_q: q || null, p_limit: 100 }) : { data: [] };
  const users = (us ?? []) as AdminUser[];
  // Templates in any state (RLS lets moderators see them all). Search is a plain title match.
  let allTemplates: TemplateCard[] = [];
  if (tab === 'templates') {
    let tq = db.from('template_cards').select('*').order('created_at', { ascending: false }).limit(100);
    if (status !== 'all') tq = tq.eq('status', status);
    if (q) tq = tq.ilike('title', `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    allTemplates = ((await tq).data ?? []) as TemplateCard[];
  }
  const { data: scanRows } = tab === 'scans'
    ? await db.from('template_files').select('id, original_name, size_bytes, scan_status, reject_reason, created_at, scanned_at, template:templates(title, slug, status)')
        .in('scan_status', ['pending', 'scanning', 'infected', 'rejected']).order('created_at', { ascending: false }).limit(100)
    : { data: [] };
  const scans = (scanRows ?? []) as unknown as { id: string; original_name: string; size_bytes: number; scan_status: string; reject_reason: string | null; created_at: string; template: { title: string; slug: string; status: string } | null }[];
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
      <nav aria-label="Moderation sections" className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => [t.id, t.id === 'queue' ? `${t.label} (${pending.length})` : t.id === 'reports' ? `${t.label} (${(reports ?? []).length})` : t.label] as const).map(([id, label]) => (
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

        {tab === 'overview' && overview && (
          <div className="flex flex-col gap-8">
            {([
              ['People', [['Members', overview.users, 'users'], ['Joined this week', overview.users_7d, 'users'], ['Online now', overview.online_now, null], ['Suspended', overview.suspended, 'users']]],
              ['Templates', [['Published', overview.published, 'templates'], ['Waiting for review', overview.pending, 'queue'], ['Drafts', overview.drafts, 'templates'], ['Removed', overview.removed, 'templates']]],
              ['Safety', [['Open reports', overview.open_reports, 'reports'], ['Files being scanned', overview.scan_queue, 'scans'], ['Files rejected (7 days)', overview.scan_rejected_7d, 'scans']]],
              ['Activity (7 days)', [['Downloads', overview.downloads_7d, null], ['Votes', overview.votes_7d, null], ['Posts', overview.posts_7d, null]]],
            ] as [string, [string, number, string | null][]][]).map(([group, tiles]) => (
              <section key={group} aria-label={group} className="flex flex-col gap-3">
                <h2 className="eyebrow m-0">{group}</h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {tiles.map(([label, n, to]) => {
                    const body = <><span className="text-[13px] text-ink-2">{label}</span><span className="font-display text-4xl">{formatCount(n)}</span></>;
                    const cls = 'flex flex-col gap-1 rounded-xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)]';
                    return to && allowed.includes(to)
                      ? <Link key={label} href={`/admin?tab=${to}`} className={`${cls} hover:bg-surface-2`}>{body}</Link>
                      : <div key={label} className={cls}>{body}</div>;
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {tab === 'templates' && (
          <div className="flex flex-col gap-4">
            <form className="flex flex-wrap gap-2" action="/admin" method="get">
              <input type="hidden" name="tab" value="templates" />
              <label className="sr-only" htmlFor="tq">Search templates by title</label>
              <input id="tq" name="q" defaultValue={q} placeholder="Search by title" className="field h-10 max-w-xs" />
              <label className="sr-only" htmlFor="ts">Status</label>
              <select id="ts" name="status" defaultValue={status} className="field h-10 w-auto">
                {STATUSES.map((st) => <option key={st} value={st}>{st === 'all' ? 'All statuses' : st.replace('_', ' ')}</option>)}
              </select>
              <button className="btn btn-secondary h-10">Search</button>
            </form>
            {allTemplates.length === 0 ? <EmptyState title="No templates match" /> : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {allTemplates.map((t) => (
                  <li key={t.id} className="grid gap-4 rounded-xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] md:grid-cols-[140px_1fr_320px]">
                    <div className="aspect-[16/10] overflow-hidden rounded-md"><Cover seed={t.slug} title={t.title} coverPath={t.cover_path} kind={t.category_kind} /></div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-2 font-semibold">
                        {t.status === 'published' || t.status === 'unlisted' ? <Link href={`/t/${t.slug}`} className="hover:text-accent-ink">{t.title}</Link> : t.title}
                        <StatusPill status={t.status} />
                      </span>
                      <span className="text-[13px] text-ink-2">@{t.owner_username} · {t.category_name ?? 'No category'} · {formatCount(t.vote_count)} votes · {formatCount(t.download_count)} downloads</span>
                      <span className="text-[12px] text-ink-3">Created {timeAgo(t.created_at)}</span>
                    </div>
                    <TemplateModActions id={t.id} status={t.status} canRemove />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'users' && (
          <div className="flex flex-col gap-4">
            <form className="flex flex-wrap gap-2" action="/admin" method="get">
              <input type="hidden" name="tab" value="users" />
              <label className="sr-only" htmlFor="uq">Search users</label>
              <input id="uq" name="q" defaultValue={q} placeholder="Search by username, name or email" className="field h-10 max-w-sm" />
              <button className="btn btn-secondary h-10">Search</button>
            </form>
            <p className="m-0 text-[13px] text-ink-3">Newest first, up to 100. Emails are shown to admins only. Every change here is written to the audit log.</p>
            {users.length === 0 ? <EmptyState title="No users match" /> : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {users.map((u) => (
                  <li key={u.id} className={`flex flex-wrap items-center gap-3 rounded-xl p-3 shadow-[inset_0_0_0_1px_var(--line)] ${u.suspended ? 'bg-[color-mix(in_oklab,var(--danger)_8%,var(--surface-1))]' : 'bg-surface-1'}`}>
                    <Avatar name={u.display_name} path={u.avatar_path} seed={u.username} size={40} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/@${u.username}`} className="truncate font-semibold hover:text-accent-ink">{u.display_name}</Link>
                        <span className="text-[13px] text-ink-3">@{u.username}</span>
                        {u.roles.map((r) => <span key={r} className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10.5px] uppercase">{r === 'reviewer' ? 'sub-admin' : r}</span>)}
                        {u.trust_level > 0 && <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10.5px] uppercase">trusted</span>}
                        {u.suspended && <span className="rounded-full bg-danger px-2 py-0.5 font-mono text-[10.5px] text-white uppercase">suspended</span>}
                      </span>
                      <span className="truncate text-[12.5px] text-ink-2">{u.email}</span>
                      <span className="text-[12px] text-ink-3">
                        Joined {timeAgo(u.created_at)} · {u.last_seen_at ? `seen ${timeAgo(u.last_seen_at)}` : 'not seen yet'} · {u.template_count} published
                        {u.suspended && u.suspended_reason ? ` · Suspended: ${u.suspended_reason}` : ''}
                      </span>
                    </span>
                    <UserAdminActions userId={u.id} isModerator={u.roles.includes('moderator')} isAdmin={u.roles.includes('admin')}
                                      trusted={u.trust_level > 0} suspended={u.suspended} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'scans' && (scans.length === 0 ? <EmptyState title="Nothing waiting or rejected" body="Files being scanned and files the scanner rejected show up here." /> : (
          <div className="overflow-x-auto rounded-xl shadow-[inset_0_0_0_1px_var(--line)]">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Files in the malware scan queue or rejected by it</caption>
              <thead className="text-[12px] text-ink-3"><tr className="border-b border-line">
                {['File', 'Template', 'Status', 'Reason', 'Uploaded'].map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {scans.map((f) => (
                  <tr key={f.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-mono">{f.original_name} <span className="text-ink-3">· {formatBytes(Number(f.size_bytes))}</span></td>
                    <td className="px-4 py-2.5">{f.template?.title ?? '—'}</td>
                    <td className={`px-4 py-2.5 font-mono ${f.scan_status === 'infected' || f.scan_status === 'rejected' ? 'text-danger' : 'text-info'}`}>{f.scan_status}</td>
                    <td className="px-4 py-2.5 text-ink-2">{f.reject_reason ?? ''}</td>
                    <td className="px-4 py-2.5 text-ink-2">{timeAgo(f.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {tab === 'team' && (
          <section aria-labelledby="team-title" className="flex flex-col gap-4">
            <div>
              <h2 id="team-title" className="m-0 text-lg font-semibold">Sub-admins</h2>
              <p className="m-0 text-[13px] text-ink-2">Sub-admins must be your friends: they follow you and you follow them back. Followers you don&apos;t follow yet have a Follow back button. Sub-admins can approve uploads or ask for changes; they can&apos;t remove templates, see reports or the audit log, or add other sub-admins.</p>
            </div>
            {candidates.length === 0 ? <EmptyState title="No followers yet" body="When people follow you, you can make them sub-admins here." /> : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {candidates.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-xl bg-surface-1 p-3 shadow-[inset_0_0_0_1px_var(--line)]">
                    <Avatar name={c.display_name} path={c.avatar_path} seed={c.username} size={40} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Link href={`/@${c.username}`} className="truncate font-semibold hover:text-accent-ink">{c.display_name}</Link>
                      <span className="truncate text-[13px] text-ink-3">@{c.username}{c.is_sub_admin ? ' · Sub-admin' : ''}{c.is_friend ? ' · Friend' : c.follows_you ? ' · Follows you' : ' · No longer follows you'}</span>
                    </span>
                    <SubAdminToggle userId={c.id} on={c.is_sub_admin} isFriend={c.is_friend} />
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
