'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import {
  addGroupMembers, createGroup, leaveGroup, listFriendsToAdd, removeGroupMember, renameGroup, setGroupAdmin,
  type FriendPick, type GroupMember,
} from '@/app/actions/messages';
import { Avatar } from './bits';
import { Dialog } from './dialog';
import { Icon } from './icons';
import { useToast } from './toast';

const MAX_PEOPLE = 10;

/** Tick friends to add. Only friends show up: the database only lets you add friends anyway. */
function FriendPicker({ exclude, picked, onToggle, room }: { exclude: Set<string>; picked: Set<string>; onToggle: (id: string) => void; room: number }) {
  const [friends, setFriends] = useState<FriendPick[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    let live = true;
    listFriendsToAdd().then((f) => { if (live) setFriends(f); });
    return () => { live = false; };
  }, []);
  const term = q.trim().toLowerCase().replace(/^@/, '');
  const shown = (friends ?? []).filter((f) => !exclude.has(f.id))
    .filter((f) => !term || f.display_name.toLowerCase().includes(term) || f.username.toLowerCase().includes(term));
  return (
    <div className="flex flex-col gap-2">
      <label className="flex h-10 items-center gap-2 rounded-full bg-surface-2 px-3.5 text-ink-3 focus-within:shadow-[inset_0_0_0_2px_var(--accent)]">
        <Icon name="search" size={15} className="shrink-0" />
        <span className="sr-only">Search friends</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your friends" autoComplete="off"
               className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3" />
      </label>
      <ul className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0">
        {friends === null ? [0, 1, 2].map((i) => <li key={i}><span className="skeleton my-1 block h-11" /></li>)
          : shown.length === 0 ? (
            <li className="px-2 py-6 text-center text-[13.5px] text-ink-3">
              {(friends ?? []).length === 0 ? 'No friends yet. Friends are people you follow who follow you back.' : term ? 'No friends match.' : 'All your friends are already here.'}
            </li>
          ) : shown.map((f) => {
            const on = picked.has(f.id);
            const full = !on && picked.size >= room;
            return (
              <li key={f.id}>
                <label className={`flex items-center gap-3 rounded-xl px-2 py-2 ${full ? 'opacity-50' : 'cursor-pointer hover:bg-surface-2'}`}>
                  <input type="checkbox" aria-label={f.display_name} checked={on} disabled={full} onChange={() => onToggle(f.id)} className="h-[18px] w-[18px] shrink-0 accent-[var(--accent)]" />
                  <Avatar name={f.display_name} path={f.avatar_path} seed={f.username} size={36} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium">{f.display_name}</span>
                    <span className="truncate text-[12.5px] text-ink-3">@{f.username}</span>
                  </span>
                </label>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

function useToggleSet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSet((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return [set, toggle, () => setSet(new Set())] as const;
}

export function NewGroupDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [picked, toggle, reset] = useToggleSet();
  const [pending, start] = useTransition();
  const close = () => { setName(''); reset(); onClose(); };
  const create = () => start(async () => {
    const r = await createGroup(name, [...picked]);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    close();
    onCreated(r.data.id);
  });
  return (
    <Dialog open={open} onClose={close} title="New group" width={480}>
      <form onSubmit={(e) => { e.preventDefault(); create(); }} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Group name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="e.g. Weekend build crew" className="field" />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Add friends <span className="text-ink-3">({picked.size} picked · 2 to {MAX_PEOPLE - 1})</span></span>
          <FriendPicker exclude={new Set()} picked={picked} onToggle={toggle} room={MAX_PEOPLE - 1} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="btn btn-ghost">Cancel</button>
          <button disabled={pending || !name.trim() || picked.size < 2} className="btn btn-primary">{pending ? 'Creating…' : 'Create group'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Who's in the group, plus the admin tools (add, remove, make admin) and Leave. */
export function GroupMembersDialog({ id, me, members, myRole, onClose, onChanged, onLeft }: {
  id: string; me: string; members: GroupMember[]; myRole: 'admin' | 'member' | null;
  onClose: () => void; onChanged: () => void; onLeft: () => void;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [picked, toggle, reset] = useToggleSet();
  const [pending, start] = useTransition();
  const admin = myRole === 'admin';
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    if (done) toast({ text: done, tone: 'ok' });
    onChanged();
  });
  const add = () => act(async () => {
    const r = await addGroupMembers(id, [...picked]);
    if (r.ok) { reset(); setAdding(false); }
    return r;
  }, 'Added to the group.');
  const leave = () => start(async () => {
    if (!window.confirm('Leave this group? You won\'t see its messages any more.')) return;
    const r = await leaveGroup(id);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    toast({ text: 'You left the group.', tone: 'ok' });
    onLeft();
  });

  return (
    <Dialog open onClose={onClose} title={adding ? 'Add people' : `Members · ${members.length}`} width={480}>
      {adding ? (
        <div className="flex flex-col gap-4">
          <FriendPicker exclude={new Set(members.map((m) => m.user_id))} picked={picked} onToggle={toggle} room={MAX_PEOPLE - members.length} />
          <p className="m-0 text-[12.5px] text-ink-3">Groups can have up to {MAX_PEOPLE} people. You can add your own friends.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { reset(); setAdding(false); }} className="btn btn-ghost">Back</button>
            <button type="button" disabled={pending || picked.size === 0} onClick={add} className="btn btn-primary">Add {picked.size || ''}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {admin && members.length < MAX_PEOPLE && (
            <button type="button" onClick={() => setAdding(true)} className="btn btn-secondary self-start"><Icon name="plus" size={16} />Add people</button>
          )}
          <ul className="m-0 flex max-h-[50vh] list-none flex-col overflow-y-auto p-0">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <Link href={`/@${m.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={m.display_name} path={m.avatar_path} seed={m.username} size={40} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium">{m.display_name}{m.user_id === me ? ' (you)' : ''}</span>
                    <span className="truncate text-[12.5px] text-ink-3">@{m.username}{m.role === 'admin' ? ' · Admin' : ''}{m.is_creator ? ' · Started the group' : ''}</span>
                  </span>
                </Link>
                {admin && m.user_id !== me && (
                  <span className="flex shrink-0 gap-1">
                    {!(m.is_creator && m.role === 'admin') && (
                      <button type="button" disabled={pending} onClick={() => act(() => setGroupAdmin(id, m.user_id, m.role !== 'admin'))}
                              className="btn btn-ghost h-8 px-2.5 text-[12.5px]">{m.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>
                    )}
                    {!m.is_creator && (
                      <button type="button" disabled={pending} aria-label={`Remove ${m.display_name} from the group`} title="Remove from group"
                              onClick={() => { if (window.confirm(`Remove ${m.display_name} from the group?`)) act(() => removeGroupMember(id, m.user_id)); }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-danger hover:bg-surface-2"><Icon name="x" size={15} /></button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <button type="button" disabled={pending} onClick={leave} className="btn btn-ghost self-start text-danger"><Icon name="logout" size={16} />Leave group</button>
        </div>
      )}
    </Dialog>
  );
}

export function RenameGroupDialog({ id, current, onClose, onChanged }: { id: string; current: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(current);
  const [pending, start] = useTransition();
  return (
    <Dialog open onClose={onClose} title="Rename group">
      <form onSubmit={(e) => { e.preventDefault(); start(async () => {
        const r = await renameGroup(id, name);
        if (!r.ok) return toast({ text: r.error, tone: 'error' });
        onChanged();
        onClose();
      }); }} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Group name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus className="field" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button disabled={pending || !name.trim() || name.trim() === current} className="btn btn-primary">Save</button>
        </div>
      </form>
    </Dialog>
  );
}
