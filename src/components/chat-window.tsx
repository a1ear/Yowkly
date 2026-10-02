'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { realtimeClient } from '@/lib/supabase/browser';
import { listConversations, loadMessage, type ChatMessage, type Conversation } from '@/app/actions/messages';
import { MESSAGES_EVENT } from '@/lib/events';
import { ConvoAvatar } from './convo-avatar';
import { Icon } from './icons';
import { Thread, type ThreadBus } from './messenger';
import { useMe } from './header-account';

/** One floating chat box. Listens to just its own conversation over Realtime (RLS-filtered). */
export function ChatWindow({ id, minimized, onToggle, onClose }: { id: string; minimized: boolean; onToggle: () => void; onClose: () => void }) {
  const me = useMe();
  const [convo, setConvo] = useState<Conversation | null>(null);
  const busRef = useRef<ThreadBus | null>(null);

  const refresh = useCallback(async () => {
    const list = await listConversations();
    setConvo((list ?? []).find((c) => c.id === id) ?? null);
    window.dispatchEvent(new CustomEvent(MESSAGES_EVENT, { detail: (list ?? []).filter((c) => c.status === 'active').reduce((n, c) => n + c.unread, 0) }));
  }, [id]);

  useEffect(() => {
    let live = true;
    listConversations().then((list) => { if (live) setConvo((list ?? []).find((c) => c.id === id) ?? null); });
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    let cleanup = () => {};
    let cancelled = false;
    realtimeClient().then((db) => {
    if (cancelled) return;
    const channel = db.channel(`dock-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, async (payload: { new: Record<string, unknown> }) => {
        const full = await loadMessage(String(payload.new.id));
        if (full) busRef.current?.incoming(full as ChatMessage);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, (payload: { new: Record<string, unknown> }) => {
        if (payload.new.deleted_at) busRef.current?.unsent(String(payload.new.id));
      })
      .subscribe();
    cleanup = () => { db.removeChannel(channel); };
    });
    return () => { cancelled = true; cleanup(); };
  }, [id]);

  if (minimized) {
    return (
      <div className="pointer-events-auto flex w-[240px] items-center gap-2 rounded-t-xl bg-surface-1 px-3 py-2 shadow-e3 ring-1 ring-line">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={`Open chat with ${convo?.other_display_name ?? 'contact'}`}>
          {convo && <ConvoAvatar c={convo} size={26} />}
          <span className="truncate text-[13.5px] font-medium">{convo?.other_display_name ?? 'Chat'}</span>
          {convo && convo.unread > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
        </button>
        <button type="button" onClick={onClose} aria-label="Close chat" className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2"><Icon name="x" size={14} /></button>
      </div>
    );
  }
  return (
    <section aria-label={`Chat with ${convo?.other_display_name ?? 'contact'}`}
             className="msg-in-mine pointer-events-auto flex h-[460px] w-[340px] flex-col overflow-hidden rounded-t-2xl bg-surface-1 shadow-e3 ring-1 ring-line">
      {me ? (
        <Thread id={id} me={me.id} convo={convo} busRef={busRef} onBack={onClose} onChanged={refresh} dock={{ onMinimize: onToggle, onClose }} />
      ) : <span className="skeleton m-3 block h-full" />}
    </section>
  );
}
