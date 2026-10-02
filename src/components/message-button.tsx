'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { openConversation } from '@/app/actions/messages';
import { useToast } from './toast';
import { Icon } from './icons';
import { openChat } from './chat-dock';

/** Opens (or starts) a chat with someone. Friends chat straight away; anyone else gets a message request. */
export function MessageButton({ userId, className = 'btn btn-secondary', compact = false }: { userId: string; className?: string; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} aria-label="Message" title="Message" className={className}
            onClick={() => start(async () => {
              const r = await openConversation(userId);
              if (!r.ok) return toast({ text: r.error, tone: 'error' });
              openChat(r.data.id, router.push);
            })}>
      <Icon name="comment" size={16} />{!compact && 'Message'}
    </button>
  );
}
