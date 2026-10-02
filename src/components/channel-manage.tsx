'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import {
  channelMembers, channelStaffData, deleteChannel, moderateMember, myChannelState, setChannelRole, updateChannel,
  type ChannelBan, type ChannelLog, type ChannelMember,
} from '@/app/actions/channels';
import { Avatar } from './bits';
import { Icon } from './icons';
import { CreateChannelDialog } from './channels';
import { useMe } from './header-account';
import { useToast } from './toast';
import { timeAgo } from '@/lib/format';

export function NewChannelButton() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (me === null) return <Link href="/auth/sign-in?next=/community/channels" className="btn btn-secondary">Sign in to create one</Link>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={!me} className="btn btn-primary"><Icon name="plus" size={16} />Create channel</button>
      {open && <CreateChannelDialog onClose={() => setOpen(false)} />}
    </>
  );
}

type Tab = 'members' | 'banned' | 'settings' | 'log';

/** Members, bans, settings and the mod log for a channel's owner and moderators. */
export function ChannelManager({ channel }: { channel: { id: string; slug: string; name: string; description: string; rules: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [role, setRole] = useState<'owner' | 'mod' | 'member' | null | undefined>(undefined);
  const [siteMod, setSiteMod] = useState(false);
  const [tab, setTab] = useState<Tab>('members');
  const [q, setQ] = useState('');
  const [members, setMembers] = useState<ChannelMember[] | null>(null);
  const [staffData, setStaffData] = useState<{ bans: ChannelBan[]; log: ChannelLog[] } | null>(null);
  const [acting, setActing] = useState<{ user: ChannelMember; kind: 'ban' } | null>(null);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState({ name: channel.name, description: channel.description, rules: channel.rules });
  const [confirmDelete, setConfirmDelete] = useState('');
  const [pending, start] = useTransition();

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([channelMembers(channel.id), channelStaffData(channel.id)]);
    setMembers(m);
    setStaffData(s);
  }, [channel.id]);

  useEffect(() => {
    let live = true;
    myChannelState(channel.id).then((s) => { if (!live) return; setRole(s.role); setSiteMod(s.siteMod); });
    Promise.all([channelMembers(channel.id), channelStaffData(channel.id)]).then(([m, s]) => { if (live) { setMembers(m); setStaffData(s); } });
    return () => { live = false; };
  }, [channel.id]);

  if (role === undefined) return <span className="skeleton mt-8 block h-40" />;
  const isOwner = role === 'owner' || siteMod;
  if (role !== 'owner' && role !== 'mod' && !siteMod) {
    return <p className="mt-8 rounded-xl border border-dashed border-line px-6 py-12 text-center text-ink-2">Only this channel&apos;s owner and moderators can manage it.</p>;
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast({ text: r.error ?? 'Something went wrong.', tone: 'error' });
    toast({ text: done, tone: 'ok' });
    setActing(null); setReason('');
    await load();
  });

  const shown = (members ?? []).filter((m) => !q || m.display_name.toLowerCase().includes(q.toLowerCase()) || m.username.toLowerCase().includes(q.toLowerCase()));
  const canActOn = (m: ChannelMember) => m.role === 'member' || (m.role === 'mod' && isOwner);
  const tabs: [Tab, string][] = [['members', `Members (${members?.length ?? 0})`], ['banned', `Banned (${staffData?.bans.length ?? 0})`], ...(isOwner ? [['settings', 'Settings'] as [Tab, string]] : []), ['log', 'Mod log']];

  return (
    <div className="mt-6 flex flex-col gap-5">
      <nav aria-label="Manage sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}
                  className="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-ink-2 aria-[current=page]:border-accent aria-[current=page]:text-ink">{label}</button>
        ))}
      </nav>

      {tab === 'members' && (
        <div className="flex flex-col gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" aria-label="Search members" className="field max-w-sm" />
          {members === null ? <span className="skeleton block h-32" /> : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {shown.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-1 p-3 shadow-[inset_0_0_0_1px_var(--line)]">
                  <Avatar name={m.display_name} path={m.avatar_path} seed={m.username} size={36} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <Link href={`/@${m.username}`} className="truncate font-medium hover:text-accent-ink">{m.display_name}</Link>
                    <span className="truncate text-[12.5px] text-ink-3">@{m.username} · joined {timeAgo(m.joined_at)}</span>
                  </span>
                  {m.role !== 'member' && <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10.5px] uppercase">{m.role}</span>}
                  {m.role !== 'owner' && (
                    <span className="flex flex-wrap gap-1.5">
                      {role === 'owner' && (
                        <button type="button" disabled={pending} className="btn btn-secondary h-8 px-2.5 text-[12.5px]"
                                onClick={() => run(() => setChannelRole(channel.id, m.user_id, m.role === 'mod' ? 'member' : 'mod', channel.slug), m.role === 'mod' ? 'Moderator removed.' : 'Made a moderator.')}>
                          {m.role === 'mod' ? 'Remove mod' : 'Make mod'}
                        </button>
                      )}
                      {canActOn(m) && <>
                        <button type="button" disabled={pending} className="btn btn-secondary h-8 px-2.5 text-[12.5px]"
                                onClick={() => run(() => moderateMember(channel.id, m.user_id, 'kick', '', channel.slug), `Removed ${m.display_name}.`)}>Kick</button>
                        <button type="button" disabled={pending} onClick={() => setActing({ user: m, kind: 'ban' })} className="btn btn-danger h-8 px-2.5 text-[12.5px]">Ban</button>
                      </>}
                    </span>
                  )}
                  {acting?.user.user_id === m.user_id && (
                    <span className="flex w-full gap-2">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus aria-label="Reason for the ban"
                             placeholder="Reason (they will see it)" className="field h-9 min-w-0 flex-1" />
                      <button type="button" onClick={() => setActing(null)} className="btn btn-ghost h-9 px-3">Cancel</button>
                      <button type="button" disabled={pending || reason.trim().length < 3} className="btn btn-danger h-9 px-3"
                              onClick={() => run(() => moderateMember(channel.id, m.user_id, 'ban', reason, channel.slug), `Banned ${m.display_name}.`)}>Ban</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'banned' && (staffData?.bans.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {staffData.bans.map((b) => (
            <li key={b.user_id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-1 p-3 shadow-[inset_0_0_0_1px_var(--line)]">
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <Link href={`/@${b.username}`} className="font-medium hover:text-accent-ink">{b.display_name}</Link>
                <span className="text-[12.5px] text-ink-3">Banned {timeAgo(b.created_at)}: {b.reason}</span>
              </span>
              <button type="button" disabled={pending} className="btn btn-secondary h-8 px-2.5 text-[12.5px]"
                      onClick={() => run(() => moderateMember(channel.id, b.user_id, 'unban', '', channel.slug), `Unbanned ${b.display_name}.`)}>Unban</button>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-ink-3">Nobody is banned.</p>)}

      {tab === 'settings' && isOwner && (
        <div className="flex flex-col gap-8">
          <form className="flex max-w-xl flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(() => updateChannel(channel.id, form, channel.slug), 'Channel updated.'); }}>
            <label className="flex flex-col gap-1.5"><span className="label">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={3} maxLength={40} className="field" /></label>
            <label className="flex flex-col gap-1.5"><span className="label">Description</span>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} rows={3} className="field h-auto py-2.5" /></label>
            <label className="flex flex-col gap-1.5"><span className="label">Rules</span>
              <textarea value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} maxLength={2000} rows={6} className="field h-auto py-2.5"
                        placeholder={'1. Stay on topic\n2. Be kind\n3. No spam'} /></label>
            <button className="btn btn-primary self-start" disabled={pending}>Save changes</button>
          </form>
          <section className="flex max-w-xl flex-col gap-3 rounded-xl p-5 shadow-[inset_0_0_0_1px_var(--danger)]">
            <h2 className="m-0 text-base font-semibold text-danger">Delete channel</h2>
            <p className="m-0 text-[13.5px] text-ink-2">Its posts are hidden and members are removed. This can&apos;t be undone. Type the channel address <code>{channel.slug}</code> to confirm.</p>
            <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} aria-label="Type the channel address to confirm" className="field" />
            <button type="button" disabled={pending || confirmDelete !== channel.slug} className="btn btn-danger self-start"
                    onClick={() => start(async () => {
                      const r = await deleteChannel(channel.id, channel.slug);
                      if (!r.ok) return toast({ text: r.error, tone: 'error' });
                      toast({ text: 'Channel deleted.', tone: 'ok' });
                      router.push('/community');
                    })}>Delete {channel.name}</button>
          </section>
        </div>
      )}

      {tab === 'log' && (staffData?.log.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13.5px]">
          {staffData.log.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-x-2 rounded-lg px-3 py-2 odd:bg-surface-1">
              <span className="text-ink-3">{timeAgo(l.created_at)}</span>
              <span>@{l.actor ?? 'someone'}</span>
              <span className="font-mono text-ink-2">{l.action.replace('_', ' ')}</span>
              {l.reason && <span className="text-ink-2">: {l.reason}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-ink-3">No moderation actions yet.</p>)}
    </div>
  );
}
