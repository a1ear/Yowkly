import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/clients';
import { EmptyState } from '@/components/bits';
import { Icon, type IconName } from '@/components/icons';
import { MarkAllRead } from '@/components/mark-all-read';
import { timeAgo } from '@/lib/format';

export const metadata: Metadata = { title: 'Notifications', robots: { index: false } };

type N = {
  id: number; type: string; data: Record<string, unknown>; read_at: string | null; created_at: string;
  actor: { username: string; display_name: string } | null; template: { slug: string; title: string } | null;
};

function describe(n: N): [IconName, React.ReactNode] {
  const who = n.actor ? <Link href={`/@${n.actor.username}`} className="font-semibold hover:text-accent-ink">{n.actor.display_name}</Link> : 'Someone';
  const what = n.template ? <Link href={`/t/${n.template.slug}`} className="font-semibold hover:text-accent-ink">{n.template.title}</Link> : 'your template';
  switch (n.type) {
    case 'follow': return ['user', <>{who} started following you</>];
    case 'like_milestone': return ['heart', <>{what} reached {String(n.data.count)} likes</>];
    case 'comment': return ['info', <>{who} commented on {what}</>];
    case 'reply': return ['info', <>{who} replied to your comment on {what}</>];
    case 'award': return n.data.kind === 'dev_of_week'
      ? ['award', <>You&apos;re Dev of the Week with {String(n.data.votes)} votes</>]
      : ['award', <>{what} took a top spot in the Ranking</>];
    case 'upload_approved': return ['check', <>{what} was approved and is live</>];
    case 'upload_rejected': return ['alert', <>A moderator asked for changes to {what}: {String(n.data.reason ?? '')}</>];
    case 'template_removed': return ['x', <>{what} was removed: {String(n.data.reason ?? '')}</>];
    case 'scan_failed': return ['shield', <>{String(n.data.file ?? 'A file')} was rejected by the malware scan: {String(n.data.reason ?? '')}</>];
    default: return ['bell', <>Update on {what}</>];
  }
}

function groupByDay(items: N[]): [string, N[]][] {
  const dayAgo = Date.now() - 864e5;
  return [
    ['Today', items.filter((n) => new Date(n.created_at).getTime() > dayAgo)],
    ['Earlier', items.filter((n) => new Date(n.created_at).getTime() <= dayAgo)],
  ];
}

export default async function NotificationsPage() {
  const db = await userClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) redirect('/auth/sign-in?next=/notifications');
  const { data } = await db.from('notifications')
    .select('id, type, data, read_at, created_at, actor:profiles!notifications_actor_id_fkey(username, display_name), template:templates(slug, title)')
    .order('created_at', { ascending: false }).limit(100);
  const items = (data ?? []) as unknown as N[];
  const groups = groupByDay(items);
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="m-0 font-display text-5xl font-normal">Notifications</h1>
        {items.some((n) => !n.read_at) && <MarkAllRead />}
      </div>
      <div className="mt-8 flex flex-col gap-8">
        {items.length === 0 && <EmptyState title="All quiet" body="Follows, comments, rankings and review results will show up here." />}
        {groups.map(([label, list]) => list.length > 0 && (
          <section key={label} aria-labelledby={`g-${label}`}>
            <h2 id={`g-${label}`} className="eyebrow m-0 mb-3">{label}</h2>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {list.map((n) => {
                const [icon, text] = describe(n);
                return (
                  <li key={n.id} className={`flex items-start gap-3 rounded-lg px-3 py-3 ${n.read_at ? '' : 'bg-surface-1'}`}>
                    <span className="mt-0.5 text-ink-3"><Icon name={icon} size={17} /></span>
                    <span className="flex-1 text-[14px] text-ink-2">{text}</span>
                    <span className="shrink-0 text-[12px] text-ink-3">{timeAgo(n.created_at)}</span>
                    {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
