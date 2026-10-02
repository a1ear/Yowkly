'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { listConversations, type Conversation } from '@/app/actions/messages';
import { Avatar } from './bits';
import { Icon } from './icons';
import { openChat } from './chat-dock';
import { timeAgo } from '@/lib/format';

/**
 * The chat icon and its popup (like notifications): your latest conversations.
 * Clicking one opens it on the Messages page; the small pop-out icon opens it in a
 * floating chat box instead.
 */
export function MessagesBell({ unread }: { unread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Conversation[] | null>(null);
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
    if (next) setList((await listConversations()) ?? []);
  };
  const go = (id: string) => { setOpen(false); router.push(`/messages?c=${id}`); };

  const chats = (list ?? []).filter((c) => !c.incoming_request).slice(0, 8);
  const requests = (list ?? []).filter((c) => c.incoming_request).length;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}
              aria-label={unread ? `Messages, ${unread} unread` : 'Messages'} title="Messages"
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-ink hover:bg-surface-2">
        <Icon name="comment" size={20} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-on-accent shadow-[0_0_0_2px_var(--canvas)]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Messages"
             className="fixed inset-x-3 top-16 z-50 flex max-h-[min(70vh,560px)] flex-col overflow-hidden rounded-2xl bg-surface-1 shadow-e3 ring-1 ring-line md:absolute md:inset-x-auto md:top-12 md:right-0 md:w-[380px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="m-0 text-base font-semibold">Messages</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2"><Icon name="x" size={16} /></button>
          </div>
          <div className="overflow-y-auto">
            {list === null ? (
              <div className="flex flex-col gap-2 p-4">{[0, 1, 2].map((i) => <span key={i} className="skeleton block h-12 w-full" />)}</div>
            ) : (
              <>
                {requests > 0 && (
                  <button type="button" onClick={() => { setOpen(false); router.push('/messages?tab=requests'); }}
                          className="flex w-full items-center gap-2 border-b border-line px-4 py-2.5 text-left text-[13.5px] text-accent-ink hover:bg-surface-2">
                    <Icon name="mail" size={15} />{requests} message request{requests === 1 ? '' : 's'}
                  </button>
                )}
                {chats.length === 0 ? (
                  <p className="m-0 px-5 py-10 text-center text-ink-2">No chats yet. Find someone in Messages to start one.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col p-1.5">
                    {chats.map((c) => (
                      <li key={c.id} className="group relative">
                        <button type="button" onClick={() => go(c.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2 ${c.unread ? 'bg-surface-2' : ''}`}>
                          <Avatar name={c.other_display_name} path={c.other_avatar_path} seed={c.other_username} size={40} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className={`truncate ${c.unread ? 'font-semibold' : 'font-medium'}`}>{c.other_display_name}</span>
                              {c.last_message_at && <span className="shrink-0 text-[11.5px] text-ink-3">{timeAgo(c.last_message_at)}</span>}
                            </span>
                            <span className={`truncate pr-8 text-[13px] ${c.unread ? 'text-ink' : 'text-ink-3'}`}>{c.last_from_me ? 'You: ' : ''}{c.last_preview ?? 'New chat'}</span>
                          </span>
                          {c.unread > 0 && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-label={`${c.unread} unread`} />}
                        </button>
                        <button type="button" onClick={() => { setOpen(false); openChat(c.id, router.push); }} aria-label={`Open chat with ${c.other_display_name} in a chat box`} title="Open in a chat box"
                                className="absolute right-9 bottom-2.5 hidden h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-ink-2 group-hover:inline-flex hover:text-ink focus-visible:inline-flex lg:flex-none">
                          <Icon name="external" size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <Link href="/messages" onClick={() => setOpen(false)} className="border-t border-line px-4 py-3 text-center text-[13.5px] font-medium text-accent-ink hover:bg-surface-2">See all in Messages</Link>
        </div>
      )}
    </div>
  );
}
