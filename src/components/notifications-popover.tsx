'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { loadNotifications, markAllNotificationsRead, type NotificationItem } from '@/app/actions/notifications';
import { Icon, type IconName } from './icons';
import { Avatar } from './bits';
import { timeAgo } from '@/lib/format';
import { revalidate, useCached } from '@/lib/use-cached';

function describe(n: NotificationItem, close: () => void): [IconName, React.ReactNode, string | null] {
  const who = n.actor ? <Link href={`/@${n.actor.username}`} onClick={close} className="font-semibold hover:text-accent-ink">{n.actor.display_name}</Link> : 'Someone';
  const what = n.template ? <Link href={`/t/${n.template.slug}`} onClick={close} className="font-semibold hover:text-accent-ink">{n.template.title}</Link> : 'your template';
  switch (n.type) {
    case 'follow': return ['user', <>{who} started following you</>, null];
    case 'like_milestone': return ['heart', <>{what} reached {String(n.data.count)} likes</>, null];
    case 'comment': return ['info', <>{who} commented on {what}</>, null];
    case 'reply': return ['info', <>{who} replied to your comment on {what}</>, null];
    case 'award': return n.data.kind === 'dev_of_week'
      ? ['award', <>You&apos;re Dev of the Week with {String(n.data.votes)} votes</>, null]
      : ['award', <>{what} took a top spot in the Ranking</>, null];
    case 'upload_approved': return ['check', <>{what} was approved and is live</>, null];
    case 'upload_rejected': return ['alert', <>A moderator asked for changes to {what}: {String(n.data.reason ?? '')}</>, null];
    case 'template_removed': return ['x', <>{what} was removed: {String(n.data.reason ?? '')}</>, null];
    case 'scan_failed': return ['shield', <>{String(n.data.file ?? 'A file')} was rejected by the malware scan: {String(n.data.reason ?? '')}</>, null];
    case 'review_needed': return ['shield', <>{who} submitted <span className="font-semibold">{n.template?.title ?? 'a template'}</span> for review</>, '/admin'];
    default: return ['bell', <>Update on {what}</>, null];
  }
}

/**
 * The bell and its popup (no separate page). Opening it loads the latest 50 and
 * marks them read; unread ones stay highlighted until the popup closes.
 */
export function NotificationsBell({ unread, onRead }: { unread: number; onRead: () => void }) {
  const [open, setOpen] = useState(false);
  // Cached: reopening the popup shows the last list instantly while it refreshes.
  const cached = useCached<NotificationItem[] | null>(open ? 'notifications' : null, loadNotifications, 5_000);
  const items = cached === undefined ? null : (cached ?? []);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    // Clear the badge straight away (optimistic); if marking read fails, the next header refresh shows the real count.
    onRead();
    const list = await revalidate('notifications', loadNotifications);
    if (list?.some((n) => !n.read_at)) {
      await markAllNotificationsRead();
    }
  };
  const close = () => setOpen(false);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}
              aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-surface-2">
        <Icon name="bell" size={20} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-on-accent shadow-[0_0_0_2px_var(--canvas)]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications"
             className="fixed inset-x-3 top-16 z-50 flex max-h-[min(70vh,560px)] flex-col overflow-hidden rounded-2xl bg-surface-1 shadow-e3 ring-1 ring-line md:absolute md:inset-x-auto md:top-12 md:right-0 md:w-[400px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="m-0 text-base font-semibold">Notifications</h2>
            <button type="button" onClick={close} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2">
              <Icon name="x" size={16} />
            </button>
          </div>
          <div className="overflow-y-auto">
            {items === null ? (
              <div className="flex flex-col gap-2 p-4">{[0, 1, 2].map((i) => <span key={i} className="skeleton block h-12 w-full" />)}</div>
            ) : items.length === 0 ? (
              <p className="m-0 px-5 py-10 text-center text-ink-2">All quiet. Follows, comments, rankings and review results show up here.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-1.5">
                {items.map((n) => {
                  const [icon, text, href] = describe(n, close);
                  return (
                    <li key={n.id} className={`relative flex items-start gap-3 rounded-lg px-3 py-3 ${n.read_at ? '' : 'bg-surface-2'}`}>
                      {/* The person behind it (their real profile picture) with a small badge for what happened;
                          system notices (approvals, scans, rankings) keep a plain icon. */}
                      {n.actor ? (
                        <span className="relative mt-0.5 shrink-0">
                          <Avatar name={n.actor.display_name} path={n.actor.avatar_path} seed={n.actor.username} size={40} />
                          <span className="absolute -right-1 -bottom-1 inline-flex h-[20px] w-[20px] items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_0_0_2px_var(--surface-1)]">
                            <Icon name={icon} size={11} strokeWidth={2.4} />
                          </span>
                        </span>
                      ) : (
                        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-2"><Icon name={icon} size={18} /></span>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[14px] text-ink-2">{text}</span>
                        <span className="text-[12px] text-ink-3">{timeAgo(n.created_at)}</span>
                        {href && <Link href={href} onClick={close} className="mt-1 self-start text-[13px] font-medium text-accent-ink hover:underline">Open the review queue</Link>}
                      </span>
                      {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
