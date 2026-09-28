import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { StatusPill } from '@/components/status-pill';
import { RowActions } from '@/components/dashboard/row-actions';
import { LineChart } from '@/components/dashboard/line-chart';
import { Cover } from '@/components/cover';
import { EmptyState } from '@/components/bits';
import { Icon } from '@/components/icons';
import { formatCount } from '@/lib/format';
import type { TemplateCard } from '@/lib/types';

export const metadata: Metadata = { title: 'Creator dashboard', robots: { index: false } };

type Day = { day: string; views: number; downloads: number; likes: number; votes: number };

export default async function DashboardPage(props: PageProps<'/dashboard'>) {
  const sp = await props.searchParams;
  const range = [7, 30, 90].includes(Number(sp.range)) ? Number(sp.range) : 30;
  const db = await userClient();
  const { data: claims } = await db.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) redirect('/auth/sign-in?next=/dashboard');

  const [{ data: me }, { data: rows }, { data: series }, { data: scanning }] = await Promise.all([
    db.from('profiles').select('display_name, username, onboarded_at').eq('id', uid).single(),
    db.from('template_cards').select('*').eq('owner_id', uid).order('created_at', { ascending: false }),
    db.rpc('creator_analytics', { p_days: range * 2 }),
    db.from('template_files').select('template_id').eq('owner_id', uid).in('scan_status', ['pending', 'scanning']),
  ]);
  if (me && !me.onboarded_at) redirect('/onboarding');
  const templates = (rows ?? []) as TemplateCard[];
  const all = (series ?? []) as Day[];
  const prev = all.slice(0, range), cur = all.slice(range);
  const scanningIds = new Set((scanning ?? []).map((s) => s.template_id as string));

  const metric = (k: keyof Omit<Day, 'day'>) => {
    const now = cur.reduce((a, d) => a + d[k], 0);
    const before = prev.reduce((a, d) => a + d[k], 0);
    const change = before === 0 ? null : ((now - before) / before) * 100;
    return { now, change };
  };
  const cards: [string, ReturnType<typeof metric>][] = [
    ['Views', metric('views')], ['Downloads', metric('downloads')], ['Likes', metric('likes')], ['Votes', metric('votes')],
  ];

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-10 md:px-10">
      {sp.published && (
        <p role="status" className="mb-6 flex items-center gap-2 rounded-md bg-surface-1 p-3.5 text-[14px] shadow-[inset_0_0_0_1px_var(--line)]">
          <Icon name="check" size={17} className="text-success" />
          {sp.published === 'review' ? 'Submitted for review. Usually within 24 h. We’ll notify you when it’s live.' : 'Published. It’s live on Yowkly.'}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">Creator dashboard</span>
          <h1 className="m-0 mt-1 font-display text-5xl font-normal">Welcome back, {me?.display_name?.split(' ')[0]}.</h1>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Date range" className="flex rounded-md bg-surface-1 p-1 shadow-[inset_0_0_0_1px_var(--line)]">
            {[7, 30, 90].map((r) => (
              <Link key={r} href={`/dashboard?range=${r}`} aria-current={range === r ? 'page' : undefined}
                    className="inline-flex h-9 items-center rounded-sm px-3 text-[13px] text-ink-2 aria-[current=page]:bg-surface-3 aria-[current=page]:text-ink">{r} days</Link>
            ))}
          </div>
          <Link href="/upload" className="btn btn-primary"><Icon name="upload" size={16} />Upload</Link>
        </div>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([label, m]) => (
          <div key={label} className="rounded-xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
            <dt className="eyebrow">{label}</dt>
            <dd className="m-0 mt-1 font-display text-4xl">{formatCount(m.now)}</dd>
            <dd className={`m-0 mt-1 text-[12px] ${m.change == null ? 'text-ink-3' : m.change >= 0 ? 'text-success' : 'text-danger'}`}>
              {m.change == null ? `Last ${range} days` : `${m.change >= 0 ? '↑' : '↓'} ${Math.abs(m.change).toFixed(1)}% vs previous ${range} days`}
            </dd>
          </div>
        ))}
      </dl>

      <section className="mt-6 rounded-xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]" aria-labelledby="chart-title">
        <h2 id="chart-title" className="m-0 mb-4 text-base font-semibold">Views &amp; downloads</h2>
        <LineChart days={cur.map((d) => d.day)} series={[
          { name: 'Views', values: cur.map((d) => d.views), color: 'var(--accent)' },
          { name: 'Downloads', values: cur.map((d) => d.downloads), color: 'var(--info)' },
        ]} />
      </section>

      <section className="mt-10" aria-labelledby="templates-title">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="templates-title" className="m-0 font-display text-3xl font-normal">Your templates</h2>
          <span className="font-mono text-xs text-ink-3">{templates.length} template{templates.length === 1 ? '' : 's'}</span>
        </div>
        {templates.length === 0 ? (
          <EmptyState title="No templates yet" body="Upload your first template. It takes about five minutes." action={<Link href="/upload" className="btn btn-primary">Upload a template</Link>} />
        ) : (
          <div className="overflow-x-auto rounded-xl shadow-[inset_0_0_0_1px_var(--line)]">
            <table className="w-full min-w-[760px] border-collapse text-left text-[13.5px]">
              <caption className="sr-only">Your templates</caption>
              <thead className="text-[12px] text-ink-3">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 font-medium">Template</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Version</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Downloads</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Votes</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="aspect-[16/10] w-16 shrink-0 overflow-hidden rounded-sm bg-surface-2">
                          <Cover seed={t.slug} title={t.title} coverPath={t.cover_path} kind={t.category_kind} />
                        </div>
                        <span className="font-medium">{t.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusPill status={scanningIds.has(t.id) && t.status === 'draft' ? 'scanning' : t.status} /></td>
                    <td className="px-4 py-3 font-mono text-ink-2">{t.version ? `v${t.version}` : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono">{t.status === 'draft' ? '—' : formatCount(t.download_count)}</td>
                    <td className="px-4 py-3 text-right font-mono">{t.status === 'draft' ? '—' : formatCount(t.vote_count)}</td>
                    <td className="px-4 py-3"><RowActions id={t.id} slug={t.slug} status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
