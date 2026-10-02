'use client';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { OPEN_CHAT_EVENT } from '@/lib/events';

// The chat window pulls in the realtime client (~65 KB); load it only once a chat box is opened.
const ChatWindow = dynamic(() => import('./chat-window').then((m) => m.ChatWindow), { ssr: false });

const MAX_OPEN = 3;

/**
 * Floating chat boxes in the bottom-right corner (desktop), like Messenger on
 * Facebook. Opened by "Message" buttons and the pop-out icon in the messages
 * popup; hidden on the Messages page itself, which shows the full chat.
 */
export function ChatDock() {
  const pathname = usePathname();
  const [chats, setChats] = useState<{ id: string; minimized: boolean }[]>([]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = String((e as CustomEvent).detail ?? '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return;
      setChats((list) => {
        const rest = list.filter((c) => c.id !== id);
        return [...rest, { id, minimized: false }].slice(-MAX_OPEN);
      });
    };
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  }, []);

  if (!chats.length || pathname.startsWith('/messages')) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-0 z-40 hidden items-end gap-3 lg:flex" aria-label="Chats">
      {chats.map((c) => (
        <ChatWindow key={c.id} id={c.id} minimized={c.minimized}
                    onToggle={() => setChats((l) => l.map((x) => (x.id === c.id ? { ...x, minimized: !x.minimized } : x)))}
                    onClose={() => setChats((l) => l.filter((x) => x.id !== c.id))} />
      ))}
    </div>
  );
}

/** Open a conversation in a floating box (desktop), or go to the Messages page (phones, or already there). */
export function openChat(id: string, navigate: (href: string) => void) {
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  if (wide && !window.location.pathname.startsWith('/messages')) window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: id }));
  else navigate(`/messages?c=${id}`);
}
