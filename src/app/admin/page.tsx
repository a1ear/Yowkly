import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { Cover } from '@/components/cover';
import { StatusPill } from '@/components/status-pill';
import { EmptyState } from '@/components/bits';
import { TemplateModActions, ReportActions } from '@/components/admin/mod-actions';
import { formatBytes, timeAgo } from '@/lib/format';
import type { TemplateCard } from '@/lib/types';

export const metadata: Metadata = { title: 'Moderation', robots: { index: false } };

export default async function AdminPage(props: PageProps<'/admin'>) {
  const sp = await props.searchParams;
  const tab = sp.tab === 'reports' ? 'reports' : sp.tab === 'log' ? 'log' : 'queue';
  const db = await userClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) redirect('/auth/sign-in?next=/admin');
  // Server-side role check. Hiding the link is courtesy; this is the gate (and every RPC checks again).
  const { data: isMod } = await db.rpc('is_moderator');
  if (!isMod) notFound();

  const [{ data: queue }, { data: reports }, { data: log }] = await Promise.all([
    db.from('template_cards').select('*').eq('status', 'pending_review').order('created_at'),
    db.from('reports').select('id, target_type, target_id, reason, details, created_at, reporter:profiles!reports_reporter_id_fkey(username)')
      .eq('status', 'open').order('created_at').limit(100),
    tab === 'log' ? db.from('moderation_log').select('id, action, target_type, target_id, reason, created_at, actor:profiles!moderation_log_actor_id_fkey(username)')
      .order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
  ]);
  const pending = (queue ?? []) as TemplateCard[];
  const { data: files } = pending.length
    ? await db.from('template_files').select('template_id, original_name, size_bytes, scan_status, reject_reason').in('template_id', pending.map((p) => p.id))
    : { data: [] };

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-10 md:px-10">
      <h1 className="m-0 font-display text-5xl font-normal">Moderation</h1>
      <nav aria-label="Moderation sections" className="mt-6 flex gap-1 border-b border-line">
        {[['queue', `Review queue (${pending.length})`], ['reports', `Reports (${(reports ?? []).length})`], ['log', 'Audit log']].map(([id, label]) => (
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
                <TemplateModActions id={t.id} status={t.status} />
              </li>
            ))}
          </ul>
        ))}

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
