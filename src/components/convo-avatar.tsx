import type { Conversation } from '@/app/actions/messages';
import { Avatar } from './bits';

/** A chat's picture: the other person, or for a group two overlapping member photos. */
export function ConvoAvatar({ c, size = 44 }: { c: Pick<Conversation, 'kind' | 'members' | 'other_display_name' | 'other_avatar_path' | 'other_username'>; size?: number }) {
  if (c.kind !== 'group') {
    return <Avatar name={c.other_display_name} path={c.other_avatar_path} seed={c.other_username ?? c.other_display_name} size={size} />;
  }
  if (c.other_avatar_path) return <Avatar name={c.other_display_name} path={c.other_avatar_path} seed={c.other_display_name} size={size} />;
  const [a, b] = c.members ?? [];
  const small = Math.round(size * 0.68);
  if (!a) return <Avatar name={c.other_display_name} seed={c.other_display_name} size={size} />;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <span className="absolute top-0 left-0"><Avatar name={a.display_name} path={a.avatar_path} seed={a.username} size={small} /></span>
      <span className="absolute right-0 bottom-0 rounded-full shadow-[0_0_0_2px_var(--surface-1)]">
        {b ? <Avatar name={b.display_name} path={b.avatar_path} seed={b.username} size={small} />
           : <Avatar name={c.other_display_name} seed={c.other_display_name} size={small} />}
      </span>
    </span>
  );
}

/** The preview line under a chat's name: "You: …", or in a group "Ana: …". Notices and call summaries stand alone. */
export function previewLine(c: Conversation) {
  const text = c.last_preview ?? (c.kind === 'group' ? 'New group' : 'New chat');
  if (c.last_kind === 'system' || c.last_kind === 'call') return text;
  if (c.last_from_me) return `You: ${text}`;
  if (c.kind === 'group' && c.last_sender_name) return `${c.last_sender_name.split(' ')[0]}: ${text}`;
  return text;
}
