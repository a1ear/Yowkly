'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { realtimeClient } from '@/lib/supabase/browser';
import {
  chatTemplateCards, groupMembers, isBlocked, listConversations, loadMessage, loadMessages, markConversationRead,
  openConversation, respondToRequest, searchPeople, sendMessage, setBlocked, unsendMessage,
  type ChatMessage, type Conversation, type GroupMember, type PersonResult,
} from '@/app/actions/messages';
import { liveGroupCall, type LiveGroupCall } from '@/app/actions/calls';
import { shrinkImage } from '@/lib/image-shrink';
import { timeAgo } from '@/lib/format';
import { MESSAGES_EVENT, START_CALL_EVENT, START_GROUP_CALL_EVENT } from '@/lib/events';
import type { TemplateCard as Card } from '@/lib/types';
import { Avatar } from './bits';
import { ConvoAvatar, previewLine } from './convo-avatar';
import { Dialog } from './dialog';
import { GroupMembersDialog, NewGroupDialog, RenameGroupDialog } from './group-dialogs';
import { Icon } from './icons';
import { ReportDialog } from './template/panels';
import { TemplateRow } from './template-card';
import { UserStatusDot } from './presence';
import { useToast } from './toast';

const MAX = 2000;
const TEMPLATE_LINK = /(?:https?:\/\/(?:localhost:\d+|[a-z0-9-]+\.vercel\.app|yowkly\.[a-z]+))?\/t\/([a-z0-9-]{1,90})/gi;

/**
 * The inbox and one open conversation. New messages, unsends and typing dots
 * arrive over Supabase Realtime; Postgres row-level security decides who gets
 * them, so a client only ever hears about its own conversations.
 */
export function Messenger({ me, initial, initialTab = 'chats' }: { me: string; initial: string | null; initialTab?: 'chats' | 'requests' }) {
  const router = useRouter();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [tab, setTab] = useState<'chats' | 'requests'>(initialTab);
  const [openId, setOpenId] = useState<string | null>(initial);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<PersonResult[] | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const searchSeq = useRef(0);

  const onSearch = (v: string) => {
    setQuery(v);
    const seq = ++searchSeq.current;
    if (v.trim().replace(/^@/, '').length < 2) { setPeople(null); return; }
    // Small debounce; a newer keystroke wins.
    setTimeout(async () => {
      if (seq !== searchSeq.current) return;
      const found = await searchPeople(v);
      if (seq === searchSeq.current) setPeople(found);
    }, 250);
  };
  const openRef = useRef(openId);
  useEffect(() => { openRef.current = openId; }, [openId]);
  // The open conversation registers here; Realtime events call straight into it.
  const busRef = useRef<ThreadBus | null>(null);

  const apply = useCallback((l: Conversation[] | null) => {
    setList(l ?? []);
    // Keep the header's unread badge in step with the inbox.
    window.dispatchEvent(new CustomEvent(MESSAGES_EVENT, { detail: (l ?? []).filter((c) => c.status === 'active').reduce((n, c) => n + c.unread, 0) }));
  }, []);
  const refresh = useCallback(async () => apply(await listConversations()), [apply]);

  useEffect(() => {
    let live = true;
    listConversations().then((l) => { if (live) apply(l); });
    return () => { live = false; };
  }, [apply]);

  // One subscription for every conversation you're in (RLS filters the rest out).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleanup = () => {};
    let cancelled = false;
    const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 400); };
    realtimeClient().then((db) => {
    if (cancelled) return;
    const channel = db.channel('dm-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload: { new: Record<string, unknown> }) => {
        const row = payload.new as ChatMessage;
        if (row.conversation_id === openRef.current) {
          const full = await loadMessage(row.id);
          if (full) busRef.current?.incoming(full);
        }
        later();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload: { new: Record<string, unknown> }) => {
        const row = payload.new as ChatMessage;
        if (row.deleted_at) busRef.current?.unsent(row.id);
        later();
      })
      .subscribe();
    cleanup = () => { db.removeChannel(channel); };
    });
    return () => { cancelled = true; clearTimeout(timer); cleanup(); };
  }, [refresh]);

  const open = (id: string | null) => {
    setOpenId(id);
    router.replace(id ? `/messages?c=${id}` : '/messages', { scroll: false });
  };

  const chats = (list ?? []).filter((c) => !c.incoming_request);
  const requests = (list ?? []).filter((c) => c.incoming_request);
  const current = (list ?? []).find((c) => c.id === openId) ?? null;
  // Search: filters your chats by name, and finds anyone to start a new chat with.
  const q = query.trim().toLowerCase().replace(/^@/, '');
  const shown = (tab === 'chats' ? chats : requests)
    .filter((c) => !q || c.other_display_name.toLowerCase().includes(q) || (c.other_username ?? '').toLowerCase().includes(q));
  const newPeople = (people ?? []).filter((p) => !(list ?? []).some((c) => c.other_id === p.id && c.last_message_at));

  const startWith = async (p: PersonResult) => {
    const r = await openConversation(p.id);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    setQuery('');
    setPeople(null);
    setTab('chats');
    await refresh();
    open(r.data.id);
  };

  return (
    <div className="mx-auto grid h-[calc(100dvh-64px)] max-w-[1200px] md:grid-cols-[340px_1fr] md:gap-4 md:px-6 md:py-5 max-md:h-[calc(100dvh-56px-64px)]">
      <aside aria-label="Conversations" className={`${openId ? 'max-md:hidden' : ''} flex min-h-0 flex-col overflow-hidden bg-surface-1 md:rounded-2xl md:shadow-[inset_0_0_0_1px_var(--line)]`}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h1 className="m-0 font-display text-3xl font-normal">Messages</h1>
          <button type="button" onClick={() => setNewGroup(true)} title="New group" aria-label="New group chat"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-medium text-ink-2 hover:text-ink">
            <Icon name="plus" size={15} />Group
          </button>
        </div>
        <NewGroupDialog open={newGroup} onClose={() => setNewGroup(false)} onCreated={async (gid) => { setTab('chats'); await refresh(); open(gid); }} />
        <div className="px-3 pb-2">
          <label className="flex h-10 items-center gap-2 rounded-full bg-surface-2 px-3.5 text-ink-3 focus-within:shadow-[inset_0_0_0_2px_var(--accent)]">
            <Icon name="search" size={16} className="shrink-0" />
            <span className="sr-only">Search people or chats</span>
            <input type="search" value={query} onChange={(e) => onSearch(e.target.value)} placeholder="Search people to message"
                   autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3" />
          </label>
        </div>
        <div role="tablist" aria-label="Inbox" className="flex gap-1 border-b border-line px-3">
          {([['chats', 'Chats', chats.reduce((n, c) => n + c.unread, 0)], ['requests', 'Requests', requests.length]] as const).map(([id, label, n]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
                    className="-mb-px inline-flex h-11 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-ink-2 aria-selected:border-accent aria-selected:text-ink">
              {label}{n > 0 && <span className="rounded-full bg-accent px-1.5 font-mono text-[11px] text-on-accent">{n}</span>}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {q.length >= 2 && (
            <section aria-label="People" className="mb-2 border-b border-line pb-2">
              <h2 className="eyebrow m-0 px-2.5 pt-2 pb-1">People</h2>
              {people === null ? (
                <span className="skeleton mx-2 block h-12" />
              ) : newPeople.length === 0 ? (
                <p className="m-0 px-2.5 py-2 text-[13px] text-ink-3">{(people ?? []).length ? 'Already in your chats below.' : 'Nobody found with that name.'}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {newPeople.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => startWith(p)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-surface-2">
                        <Avatar name={p.display_name} path={p.avatar_path} seed={p.username} size={40} />
                        <span className="flex min-w-0 flex-1 flex-col leading-tight">
                          <span className="truncate font-medium">{p.display_name}</span>
                          <span className="truncate text-[12.5px] text-ink-3">@{p.username}{p.is_friend ? ' · Friend' : ' · Sends a message request'}</span>
                        </span>
                        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-[12.5px] font-medium text-on-accent"><Icon name="comment" size={14} />Message</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {list === null ? (
            <div className="flex flex-col gap-2 p-2">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton block h-14" />)}</div>
          ) : shown.length === 0 ? (
            <p className="m-0 px-4 py-10 text-center text-[13.5px] text-ink-3">
              {q ? 'No chats match.' : tab === 'chats' ? <>No chats yet. Search for someone above to start one.</> : 'No message requests. People who aren\'t your friends yet land here first.'}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {shown.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => open(c.id)} aria-current={c.id === openId ? 'true' : undefined}
                          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left hover:bg-surface-2 aria-[current=true]:bg-surface-2">
                    <span className="relative shrink-0">
                      <ConvoAvatar c={c} size={44} />
                      {c.is_friend && c.other_id && <UserStatusDot userId={c.other_id} size={11} className="absolute -right-0.5 -bottom-0.5" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate ${c.unread ? 'font-semibold' : 'font-medium'}`}>{c.other_display_name}</span>
                        {c.last_message_at && <span className="shrink-0 text-[11.5px] text-ink-3">{timeAgo(c.last_message_at)}</span>}
                      </span>
                      <span className={`truncate text-[13px] ${c.unread ? 'text-ink' : 'text-ink-3'}`}>
                        {c.status === 'request' && !c.incoming_request ? 'Request sent · ' : ''}{previewLine(c)}
                      </span>
                    </span>
                    {c.unread > 0 && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-label={`${c.unread} unread`} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section aria-label="Conversation" className={`${openId ? '' : 'max-md:hidden'} flex min-h-0 flex-col overflow-hidden bg-surface-1 md:rounded-2xl md:shadow-[inset_0_0_0_1px_var(--line)]`}>
        {openId ? (
          <Thread key={openId} id={openId} me={me} convo={current} busRef={busRef} onBack={() => open(null)} onChanged={refresh} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-ink-3">
            <Icon name="comment" size={32} />
            <p className="m-0">Pick a conversation, or press <strong>Message</strong> on someone&apos;s profile.</p>
          </div>
        )}
      </section>
    </div>
  );
}

type Pending = { key: string; preview: string; state: 'uploading' | 'ready' | 'failed'; path?: string; error?: string };
type Shown = ChatMessage & { clientKey?: string; pending?: boolean };
export type ThreadBus = { incoming: (m: ChatMessage) => void; unsent: (id: string) => void };

export function Thread({ id, me, convo, busRef, onBack, onChanged, dock }: {
  id: string; me: string; convo: Conversation | null; busRef: React.RefObject<ThreadBus | null>;
  onBack: () => void; onChanged: () => void;
  /** Set when shown in the floating chat box: compact header with minimise / open full / close. */
  dock?: { onMinimize: () => void; onClose: () => void };
}) {
  const toast = useToast();
  const [messages, setMessages] = useState<Shown[] | null>(null);
  // Messages that arrived or were sent while the chat is open: only these animate in.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const sendingRef = useRef(0);
  const [more, setMore] = useState(true);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Pending[]>([]);
  const [typing, setTyping] = useState(false);
  const [blocked, setBlockedState] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [groupDialog, setGroupDialog] = useState<'members' | 'rename' | null>(null);
  const [live, setLive] = useState<LiveGroupCall | null>(null);
  const [typingWho, setTypingWho] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isGroup = convo?.kind === 'group';
  const endRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTyping = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const scrollDown = (smooth = false) => requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' }));
  const markFresh = (key: string) => setFresh((s) => new Set(s).add(key));

  useEffect(() => {
    let live = true;
    loadMessages(id).then((m) => { if (!live) return; setMessages(m); setMore(m.length === 50); scrollDown(); });
    markConversationRead(id).then(onChanged);
    return () => { live = false; };
    // onChanged is stable (useCallback in the parent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!convo?.other_id || convo.kind === 'group') return;
    let live = true;
    isBlocked(convo.other_id).then((b) => { if (live) setBlockedState(b); });
    return () => { live = false; };
  }, [convo]);

  // Groups: who's in it (for names on messages), and whether a call is going on.
  const loadGroup = useCallback(() => {
    groupMembers(id).then(setMembers);
    liveGroupCall(id).then(setLive);
  }, [id]);
  useEffect(() => {
    if (!isGroup) return;
    loadGroup();
    let cleanup = () => {};
    let cancelled = false;
    realtimeClient().then((db) => {
      if (cancelled) return;
      const ch = db.channel(`group-call-bar-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `conversation_id=eq.${id}` }, () => { liveGroupCall(id).then(setLive); })
        .subscribe();
      cleanup = () => { db.removeChannel(ch); };
    });
    // The bar's head count changes as people join and leave; refresh it now and then.
    const t = setInterval(() => { liveGroupCall(id).then(setLive); }, 20_000);
    return () => { cancelled = true; cleanup(); clearInterval(t); };
  }, [isGroup, id, loadGroup]);

  // Messages arriving (or being unsent) over Realtime.
  useEffect(() => {
    busRef.current = {
      incoming: (m) => {
        // Your own message from this tab is already on screen (optimistic); the send reply swaps it in.
        if (m.sender_id === me && sendingRef.current > 0) return;
        setMessages((list) => (list && !list.some((x) => x.id === m.id) ? [...list, m] : list));
        markFresh(m.id);
        setTyping(false);
        if (m.kind === 'system') groupMembers(id).then(setMembers);
        scrollDown(true);
        if (m.sender_id !== me) markConversationRead(id).then(onChanged);
      },
      unsent: (mid) => setMessages((list) => list?.map((m) => (m.id === mid ? { ...m, deleted_at: new Date().toISOString(), body: '', images: [] } : m)) ?? list),
    };
    return () => { busRef.current = null; };
  }, [busRef, id, me, onChanged]);

  // Typing dots over a private channel only the two of you can join.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleanup = () => {};
    let cancelled = false;
    realtimeClient().then((db) => {
    if (cancelled) return;
    const ch = db.channel(`dm:${id}`, { config: { private: true } })
      .on('broadcast', { event: 'typing' }, (msg: { payload?: unknown }) => {
        const uid = (msg.payload as { uid?: string })?.uid;
        if (uid === me) return;
        setTypingWho(uid ?? null);
        setTyping(true);
        clearTimeout(timer);
        timer = setTimeout(() => setTyping(false), 3500);
      })
      .subscribe();
    channelRef.current = ch;
    cleanup = () => { db.removeChannel(ch); channelRef.current = null; };
    });
    return () => { cancelled = true; clearTimeout(timer); cleanup(); };
  }, [id, me]);

  const onType = (v: string) => {
    setText(v);
    if (Date.now() - lastTyping.current > 2000 && v.trim()) {
      lastTyping.current = Date.now();
      channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { uid: me } });
    }
  };

  const older = async () => {
    const first = messages?.[0];
    if (!first) return;
    const m = await loadMessages(id, first.created_at);
    setMore(m.length === 50);
    setMessages((list) => [...m, ...(list ?? [])]);
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files).slice(0, 4 - photos.length)) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { toast({ text: 'Use PNG, JPG, WebP or GIF images.', tone: 'error' }); continue; }
      const key = crypto.randomUUID();
      setPhotos((p) => [...p, { key, preview: URL.createObjectURL(f), state: 'uploading' }]);
      try {
        const img = await shrinkImage(f, 1600);
        const fd = new FormData();
        fd.set('file', img.blob);
        fd.set('width', String(img.width));
        fd.set('height', String(img.height));
        const res = await fetch('/api/messages/photo', { method: 'POST', body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? 'Upload failed.');
        setPhotos((p) => p.map((x) => (x.key === key ? { ...x, state: 'ready', path: body.path } : x)));
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Upload failed.';
        setPhotos((p) => p.map((x) => (x.key === key ? { ...x, state: 'failed', error } : x)));
        toast({ text: error, tone: 'error' });
      }
    }
  };

  const send = () => {
    const body = text.trim();
    const ready = photos.filter((p) => p.state === 'ready' && p.path).map((p) => p.path!);
    if (!body && !ready.length) return;
    // Show it straight away (slightly faded) and clear the box; the server's reply replaces it in place.
    const key = `tmp-${crypto.randomUUID()}`;
    const sentPhotos = photos;
    const draft: Shown = {
      id: key, clientKey: key, pending: true, conversation_id: id, sender_id: me, body, deleted_at: null,
      created_at: new Date().toISOString(),
      images: sentPhotos.filter((p) => p.state === 'ready' && p.path).map((p) => ({ path: p.path!, url: p.preview, width: null, height: null })),
    };
    setMessages((list) => [...(list ?? []), draft]);
    markFresh(key);
    setText('');
    setPhotos([]);
    scrollDown(true);
    sendingRef.current += 1;
    start(async () => {
      const r = await sendMessage(id, body, ready);
      sendingRef.current -= 1;
      if (!r.ok) {
        setMessages((list) => list?.filter((m) => m.clientKey !== key) ?? list);
        setText(body);
        setPhotos(sentPhotos);
        return toast({ text: r.error, tone: 'error' });
      }
      setMessages((list) => {
        const rest = (list ?? []).filter((m) => m.id !== r.data.id);
        return rest.map((m) => (m.clientKey === key ? { ...r.data, clientKey: key } : m));
      });
      for (const p of sentPhotos) URL.revokeObjectURL(p.preview);
      onChanged();
    });
  };

  const respond = (accept: boolean) => start(async () => {
    const r = await respondToRequest(id, accept);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    toast({ text: accept ? 'Request accepted.' : 'Request declined.', tone: 'ok' });
    onChanged();
    if (!accept) onBack();
  });

  const toggleBlock = () => start(async () => {
    if (!convo?.other_id) return;
    const r = await setBlocked(convo.other_id, !blocked);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    setBlockedState(!blocked);
    setMenu(false);
    toast({ text: blocked ? 'Unblocked.' : `Blocked ${convo.other_display_name}. Neither of you can message the other.`, tone: 'ok' });
  });

  const uploading = photos.some((p) => p.state === 'uploading');
  const outgoingRequest = convo?.status === 'request' && !convo.incoming_request;

  return (
    <>
      <header className={`flex items-center border-b border-line ${dock ? 'gap-2 px-2.5 py-1.5' : 'gap-3 px-3 py-2.5 md:px-4'}`}>
        {!dock && (
          <button type="button" onClick={onBack} aria-label="Back to conversations" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2 md:hidden">
            <Icon name="chevronLeft" size={20} />
          </button>
        )}
        {convo && isGroup ? (
          <button type="button" onClick={() => setGroupDialog('members')} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`${convo.other_display_name}: see members`}>
            <ConvoAvatar c={convo} size={dock ? 32 : 40} />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className={`truncate font-semibold ${dock ? 'text-[14px]' : ''}`}>{convo.other_display_name}</span>
              <span className="truncate text-[12.5px] text-ink-3">
                {typing ? `${members.find((x) => x.user_id === typingWho)?.display_name.split(' ')[0] ?? 'Someone'} is typing…` : `${convo.member_count} members`}
              </span>
            </span>
          </button>
        ) : convo ? (
          <Link href={`/@${convo.other_username}`} className="flex min-w-0 flex-1 items-center gap-3">
            <span className="relative shrink-0">
              <Avatar name={convo.other_display_name} path={convo.other_avatar_path} seed={convo.other_username ?? ''} size={dock ? 32 : 40} />
              {convo.is_friend && convo.other_id && <UserStatusDot userId={convo.other_id} size={11} className="absolute -right-0.5 -bottom-0.5" />}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className={`truncate font-semibold ${dock ? 'text-[14px]' : ''}`}>{convo.other_display_name}</span>
              <span className="truncate text-[12.5px] text-ink-3">{typing ? 'typing…' : `@${convo.other_username}${convo.is_friend ? ' · Friend' : ''}`}</span>
            </span>
          </Link>
        ) : <span className="flex-1" />}
        {convo && isGroup && (
          <span className="flex shrink-0">
            {([['voice', 'phoneCall', 'Group voice call'], ['video', 'video', 'Group video call']] as const).map(([kind, icon, label]) => (
              <button key={kind} type="button" aria-label={live ? 'Join the group call' : `${label} in ${convo.other_display_name}`} title={live ? 'Join call' : label}
                      onClick={() => window.dispatchEvent(new CustomEvent(START_GROUP_CALL_EVENT, { detail: { conversationId: id, video: kind === 'video', title: convo.other_display_name } }))}
                      className={`inline-flex items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-accent-ink ${dock ? 'h-8 w-8' : 'h-10 w-10'}`}>
                <Icon name={icon} size={dock ? 15 : 18} />
              </button>
            ))}
          </span>
        )}
        {convo?.is_friend && convo.kind === 'direct' && convo.status === 'active' && !blocked && (
          <span className="flex shrink-0">
            {([['voice', 'phoneCall', 'Voice call'], ['video', 'video', 'Video call']] as const).map(([kind, icon, label]) => (
              <button key={kind} type="button" aria-label={`${label} ${convo.other_display_name}`}
                      onClick={() => window.dispatchEvent(new CustomEvent(START_CALL_EVENT, { detail: {
                        conversationId: id, video: kind === 'video',
                        peer: { display_name: convo.other_display_name, username: convo.other_username ?? '', avatar_path: convo.other_avatar_path },
                      } }))}
                      className={`inline-flex items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-accent-ink ${dock ? 'h-8 w-8' : 'h-10 w-10'}`}>
                <Icon name={icon} size={dock ? 15 : 18} />
              </button>
            ))}
          </span>
        )}
        {dock && (
          <span className="flex shrink-0">
            <Link href={`/messages?c=${id}`} aria-label="Open in Messages" title="Open in Messages" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"><Icon name="external" size={15} /></Link>
            <button type="button" onClick={dock.onMinimize} aria-label="Minimise chat" title="Minimise" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"><Icon name="chevronDown" size={16} /></button>
            <button type="button" onClick={dock.onClose} aria-label="Close chat" title="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"><Icon name="x" size={15} /></button>
          </span>
        )}
        {convo && !dock && (
          <div className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} aria-label="Conversation options" aria-haspopup="menu" aria-expanded={menu}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink">
              <Icon name="kebab" size={18} />
            </button>
            {menu && (
              <div role="menu" className="absolute top-11 right-0 z-10 w-48 rounded-xl bg-surface-1 p-1.5 shadow-e2 ring-1 ring-line">
                {isGroup ? (
                  <>
                    <button role="menuitem" type="button" onClick={() => { setMenu(false); setGroupDialog('members'); }} className="flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm hover:bg-surface-2"><Icon name="user" size={16} />Members</button>
                    {convo.my_role === 'admin' && (
                      <button role="menuitem" type="button" onClick={() => { setMenu(false); setGroupDialog('rename'); }} className="flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm hover:bg-surface-2"><Icon name="settings" size={16} />Rename group</button>
                    )}
                  </>
                ) : (
                  <>
                    <Link role="menuitem" href={`/@${convo.other_username}`} className="flex h-10 items-center gap-2.5 rounded-md px-3 text-sm hover:bg-surface-2"><Icon name="user" size={16} />View profile</Link>
                    <button role="menuitem" type="button" onClick={toggleBlock} className="flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm text-danger hover:bg-surface-2">
                      <Icon name="x" size={16} />{blocked ? 'Unblock' : 'Block'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </header>
      {isGroup && live && (
        <div className="flex items-center gap-3 border-b border-line bg-[color-mix(in_oklab,var(--success)_12%,transparent)] px-3 py-2 text-[13px] md:px-4">
          <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" /><span className="relative h-2.5 w-2.5 rounded-full bg-success" /></span>
          <span className="min-w-0 flex-1 truncate">{live.video ? 'Video call' : 'Call'} going on · {live.joined} in it{live.joined >= 6 ? ' (full)' : ''}</span>
          <button type="button" disabled={live.joined >= 6}
                  onClick={() => window.dispatchEvent(new CustomEvent(START_GROUP_CALL_EVENT, { detail: { conversationId: id, video: live.video, title: convo?.other_display_name ?? 'Group' } }))}
                  className="btn btn-primary h-8 px-3 text-[12.5px] disabled:opacity-50">Join</button>
        </div>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto px-3 py-4 ${dock ? '' : 'md:px-5'}`}>
        {messages === null ? (
          <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <span key={i} className={`skeleton block h-10 w-2/3 ${i % 2 ? 'self-end' : ''}`} />)}</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {more && messages.length > 0 && <button type="button" onClick={older} className="btn btn-ghost h-8 self-center text-[12.5px]">Load earlier messages</button>}
            {messages.length === 0 && <p className="m-0 py-10 text-center text-[13.5px] text-ink-3">Say hi 👋</p>}
            {messages.map((m, i) => (
              <Bubble key={m.clientKey ?? m.id} m={m} mine={m.sender_id === me} animate={fresh.has(m.clientKey ?? m.id)} pending={Boolean(m.pending)} showTime={!messages[i - 1] || Date.parse(m.created_at) - Date.parse(messages[i - 1].created_at) > 10 * 60 * 1000}
                      showSender={isGroup && m.sender_id !== me && (messages[i - 1]?.sender_id !== m.sender_id || messages[i - 1]?.kind !== 'text' || Date.parse(m.created_at) - Date.parse(messages[i - 1].created_at) > 10 * 60 * 1000)}
                      onUnsend={() => start(async () => {
                        const original = m;
                        setMessages((l) => l?.map((x) => (x.id === m.id ? { ...x, deleted_at: new Date().toISOString(), body: '', images: [] } : x)) ?? l); // optimistic
                        const r = await unsendMessage(m.id);
                        if (!r.ok) { setMessages((l) => l?.map((x) => (x.id === m.id ? original : x)) ?? l); toast({ text: r.error, tone: 'error' }); }
                      })}
                      onReport={() => setReporting(m.id)} onView={setViewing} />
            ))}
            {typing && <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-2xl bg-surface-2 px-3 py-2" aria-label="typing"><Dot d={0} /><Dot d={150} /><Dot d={300} /></span>}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {convo?.incoming_request ? (
        <div className="flex flex-col gap-3 border-t border-line p-4 text-[13.5px]">
          <p className="m-0 text-ink-2"><strong className="text-ink">{convo.other_display_name}</strong> isn&apos;t your friend yet and wants to message you. They won&apos;t know you&apos;ve read this unless you accept or reply.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => respond(true)} className="btn btn-primary">Accept</button>
            <button type="button" disabled={pending} onClick={() => respond(false)} className="btn btn-secondary">Decline</button>
            <button type="button" disabled={pending} onClick={toggleBlock} className="btn btn-ghost text-danger">Block</button>
          </div>
        </div>
      ) : blocked ? (
        <p className="m-0 border-t border-line p-4 text-center text-[13.5px] text-ink-3">You blocked this person. <button type="button" onClick={toggleBlock} className="text-accent-ink underline">Unblock</button> to message them.</p>
      ) : (
        <div className="flex flex-col gap-2 border-t border-line p-3">
          {outgoingRequest && <p className="m-0 text-center text-[12.5px] text-ink-3">Message request sent. You can send up to 3 messages until they accept.</p>}
          {photos.length > 0 && (
            <ul className="m-0 flex list-none gap-2 p-0">
              {photos.map((p) => (
                <li key={p.key} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" className={`h-16 w-16 rounded-lg object-cover ${p.state !== 'ready' ? 'opacity-50' : ''}`} />
                  {p.state === 'failed' && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-danger" title={p.error}>Failed</span>}
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos((l) => l.filter((x) => x.key !== p.key))}
                          className="absolute -top-1.5 -right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-3 text-ink"><Icon name="x" size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photos.length >= 4} aria-label="Add photos"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 disabled:opacity-40">
              <Icon name="camera" size={20} />
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
            <label className="min-w-0 flex-1">
              <span className="sr-only">Message</span>
              <textarea value={text} onChange={(e) => onType(e.target.value)} rows={1} maxLength={MAX} placeholder="Message…"
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                        className="field max-h-40 min-h-11 resize-none py-2.5" />
            </label>
            <button disabled={pending || uploading || (!text.trim() && !photos.some((p) => p.state === 'ready'))} aria-label="Send"
                    className="btn btn-primary h-11 w-11 shrink-0 rounded-full p-0 disabled:opacity-50">
              <Icon name="arrowRight" size={18} strokeWidth={2.2} />
            </button>
          </form>
        </div>
      )}
      {reporting && <ReportDialog targetType="message" targetId={reporting} onClose={() => setReporting(null)} />}
      {isGroup && groupDialog === 'members' && (
        <GroupMembersDialog id={id} me={me} members={members} myRole={convo?.my_role ?? null} onClose={() => setGroupDialog(null)}
                            onChanged={() => { loadGroup(); onChanged(); }} onLeft={() => { setGroupDialog(null); onChanged(); if (dock) dock.onClose(); else onBack(); }} />
      )}
      {isGroup && groupDialog === 'rename' && convo && (
        <RenameGroupDialog id={id} current={convo.other_display_name} onClose={() => setGroupDialog(null)} onChanged={onChanged} />
      )}
      {viewing && (
        <Dialog open onClose={() => setViewing(null)} title="Photo" width={1000}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewing} alt="" className="max-h-[75vh] w-full rounded-lg object-contain" />
        </Dialog>
      )}
    </>
  );
}

function Dot({ d }: { d: number }) {
  return <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-3" style={{ animationDelay: `${d}ms` }} />;
}

function Bubble({ m, mine, showTime, showSender, animate, pending, onUnsend, onReport, onView }: {
  m: ChatMessage; mine: boolean; showTime: boolean; showSender?: boolean; animate: boolean; pending: boolean;
  onUnsend: () => void; onReport: () => void; onView: (url: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const slugs = useMemo(() => [...new Set([...m.body.matchAll(TEMPLATE_LINK)].map((x) => x[1].toLowerCase()))].slice(0, 3), [m.body]);
  const [cards, setCards] = useState<Card[]>([]);
  useEffect(() => {
    if (!slugs.length) return;
    let live = true;
    chatTemplateCards(slugs).then((c) => { if (live) setCards(c); });
    return () => { live = false; };
  }, [slugs]);

  if (m.deleted_at) {
    return <p className={`m-0 max-w-[75%] rounded-2xl px-3.5 py-2 text-[13px] text-ink-3 italic shadow-[inset_0_0_0_1px_var(--line)] ${mine ? 'self-end' : ''}`}>Message unsent</p>;
  }
  if (m.kind === 'call') {
    return (
      <p className={`m-0 my-1 inline-flex items-center gap-2 self-center rounded-full bg-surface-2 px-3.5 py-1.5 text-[12.5px] ${m.body.startsWith('Missed') || m.body.endsWith('declined') ? 'text-danger' : 'text-ink-2'} ${animate ? 'msg-in-theirs' : ''}`}>
        <Icon name={/video/i.test(m.body) ? 'video' : 'phoneCall'} size={13} />{m.body} · {timeAgo(m.created_at)}
      </p>
    );
  }
  if (m.kind === 'system') {
    // Group notices: "Ana added Ben", "Ben left the group".
    return <p className={`m-0 my-1 self-center px-4 text-center text-[12.5px] text-ink-3 ${animate ? 'msg-in-theirs' : ''}`}>{m.body}</p>;
  }
  return (
    <div className={`group flex flex-col gap-1 transition-opacity duration-200 ${mine ? 'items-end' : 'items-start'} ${animate ? (mine ? 'msg-in-mine' : 'msg-in-theirs') : ''} ${pending ? 'opacity-60' : ''}`}
         aria-busy={pending || undefined}>
      {showTime && <span className="self-center py-2 text-[11.5px] text-ink-3">{timeAgo(m.created_at)}</span>}
      {showSender && (
        <span className="mt-1.5 flex items-center gap-1.5 pl-1 text-[12px] text-ink-3">
          <Avatar name={m.sender?.display_name ?? 'Former member'} path={m.sender?.avatar_path} seed={m.sender?.username ?? m.sender_id} size={18} />
          {m.sender?.display_name ?? 'Former member'}
        </span>
      )}
      <div className={`flex max-w-[80%] items-center gap-1 ${mine ? 'flex-row-reverse' : ''}`}>
        <div className={`flex min-w-0 flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
          {m.images.length > 0 && (
            <div className={`grid gap-1 overflow-hidden rounded-2xl ${m.images.length > 1 ? 'grid-cols-2' : ''}`}>
              {m.images.map((i) => i.url ? (
                <button key={i.path} type="button" onClick={() => onView(i.url!)} className="overflow-hidden bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.url} alt="Photo" loading="lazy" width={i.width ?? undefined} height={i.height ?? undefined}
                       className={`${m.images.length > 1 ? 'aspect-square' : 'max-h-80'} w-full object-cover`} />
                </button>
              ) : <span key={i.path} className="flex h-24 w-32 items-center justify-center bg-surface-2 text-[12px] text-ink-3">Photo unavailable</span>)}
            </div>
          )}
          {m.body && (
            <p className={`m-0 rounded-2xl px-3.5 py-2 text-[14.5px] break-words whitespace-pre-line ${mine ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink'}`}>
              {/* Plain text; only Yowkly template links become cards below. */}
              {m.body}
            </p>
          )}
          {cards.map((c) => (
            <div key={c.id} className="w-72 max-w-full rounded-xl bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]"><TemplateRow t={c} /></div>
          ))}
        </div>
        {!pending && <div className="relative opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" onClick={() => setMenu((v) => !v)} aria-label="Message options" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2">
            <Icon name="kebab" size={15} />
          </button>
          {menu && (
            <div role="menu" className={`absolute top-9 z-10 w-40 rounded-xl bg-surface-1 p-1.5 shadow-e2 ring-1 ring-line ${mine ? 'right-0' : 'left-0'}`}>
              {mine
                ? <button role="menuitem" type="button" onClick={() => { setMenu(false); onUnsend(); }} className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-danger hover:bg-surface-2"><Icon name="trash" size={15} />Unsend</button>
                : <button role="menuitem" type="button" onClick={() => { setMenu(false); onReport(); }} className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-surface-2"><Icon name="flag" size={15} />Report</button>}
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}
