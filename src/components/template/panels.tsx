'use client';
import Link from 'next/link';
import { createContext, useContext, useEffect, useMemo, useState, useTransition } from 'react';
import { useViewerState, type ViewerState } from './viewer-state';
import { Icon } from '../icons';
import { Dialog } from '../dialog';
import { useToast } from '../toast';
import { castVote, setFollow, setLike, fileReport } from '@/app/actions/engagement';
import { createCollection, setInCollection } from '@/app/actions/collections';
import { browserClient } from '@/lib/supabase/browser';
import { YOWKBITS_EVENT } from '@/lib/events';
import { formatBytes, formatCompact, formatCount, formatShortDate } from '@/lib/format';
import { TOOL_LABEL, LICENSE_SHORT } from '@/lib/labels';
import type { TemplateFile, TemplateVersion } from '@/lib/data/template';
import type { License, LinkKind } from '@/lib/types';

type Ctx = { state: ViewerState | null; set: (fn: (s: ViewerState) => ViewerState) => void; templateId: string; slug: string };
const ViewerCtx = createContext<Ctx | null>(null);
const useViewer = () => useContext(ViewerCtx)!;

export function ViewerProvider({ templateId, ownerId, slug, licenseCode, children }: {
  templateId: string; ownerId: string; slug: string; licenseCode: string | null; children: React.ReactNode;
}) {
  const [state, setState] = useViewerState(templateId, ownerId, licenseCode);
  const value = useMemo<Ctx>(() => ({
    state, templateId, slug,
    set: (fn) => setState((s) => (s ? fn(s) : s)),
  }), [state, templateId, slug, setState]);
  return <ViewerCtx.Provider value={value}>{children}</ViewerCtx.Provider>;
}

const signInHref = (slug: string) => `/auth/sign-in?next=${encodeURIComponent(`/t/${slug}`)}`;

// ─────────────────────────────────────────────────────────── owner tools
/**
 * Only the creator sees these. The server re-checks ownership on every save
 * (RLS on templates and the version RPCs); this just puts the controls where
 * the creator is looking.
 */
export function OwnerTools({ ownerId, templateId, status }: { ownerId: string; templateId: string; status: string }) {
  const { state } = useViewer();
  if (!state || state.uid !== ownerId) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-1 p-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">Your template</span>
        {status === 'pending_review' && <span className="font-mono text-[11px] text-warning">Waiting for review</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link href={`/upload/${templateId}?step=1`} className="btn btn-secondary h-10"><Icon name="settings" size={15} />Edit details</Link>
        <Link href={`/upload/${templateId}?step=2`} className="btn btn-secondary h-10"><Icon name="upload" size={15} />New version</Link>
      </div>
      <p className="m-0 text-[12px] text-ink-3">Title, description, tags, links and images can change any time. Files and license change through a new version, so past downloads keep what they got.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────── follow
export function FollowButton({ ownerId }: { ownerId: string }) {
  const { state, set, slug } = useViewer();
  const toast = useToast();
  const [pending, start] = useTransition();
  if (state?.uid === ownerId) return null;
  if (state && !state.uid) return <Link href={signInHref(slug)} className="btn btn-secondary h-9 px-3.5">Follow</Link>;
  const following = state?.following ?? false;
  return (
    <button type="button" disabled={!state || pending} aria-pressed={following} className="btn btn-secondary h-9 px-3.5"
      onClick={() => start(async () => {
        set((s) => ({ ...s, following: !following }));
        const r = await setFollow(ownerId, !following);
        if (!r.ok) { set((s) => ({ ...s, following })); toast({ text: r.error, tone: 'error' }); }
      })}>
      {following ? <><Icon name="check" size={15} />Following</> : 'Follow'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────── like / save / share / report
export function ActionRow({ likeCount, title }: { likeCount: number; title: string }) {
  const { state, set, templateId, slug } = useViewer();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [delta, setDelta] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const liked = state?.liked ?? false;

  const toggleLike = () => {
    if (!state?.uid) return (window.location.href = signInHref(slug));
    start(async () => {
      const next = !liked;
      set((s) => ({ ...s, liked: next }));
      setDelta((d) => d + (next ? 1 : -1));
      const r = await setLike(templateId, next);
      if (!r.ok) {
        set((s) => ({ ...s, liked: !next }));
        setDelta((d) => d - (next ? 1 : -1));
        toast({ text: r.error, tone: 'error' });
      } else if (next) toast({ text: `Liked ${title}`, tone: 'ok' });
    });
  };

  const share = async () => {
    const url = `${location.origin}/t/${slug}`;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); toast({ text: 'Link copied', tone: 'ok' }); }
    } catch { /* user cancelled */ }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={toggleLike} disabled={pending || !state} aria-pressed={liked}
              aria-label={`${liked ? 'Unlike' : 'Like'}, ${formatCount(likeCount + delta)} like${likeCount + delta === 1 ? '' : 's'}`}
              className={`btn btn-secondary h-10 px-3.5 ${liked ? 'text-accent-ink' : ''}`}>
        <Icon key={String(liked)} name="heart" size={17} filled={liked} className={`shrink-0 ${liked ? 'like-pop' : ''}`} />
        <span className="font-mono text-[13px]">{formatCompact(likeCount + delta)}</span>
      </button>
      <button type="button" onClick={() => (state?.uid ? setSaveOpen(true) : (window.location.href = signInHref(slug)))}
              disabled={!state} className="btn btn-secondary h-10 px-3.5">
        <Icon name="bookmark" size={17} />Save
      </button>
      <button type="button" onClick={share} className="btn btn-secondary h-10 px-3.5"><Icon name="share" size={17} />Share</button>
      <button type="button" aria-label="Report this template" onClick={() => (state?.uid ? setReportOpen(true) : (window.location.href = signInHref(slug)))}
              className="btn btn-ghost h-10 w-10 px-0"><Icon name="flag" size={17} /></button>
      {saveOpen && <SaveDialog templateId={templateId} onClose={() => setSaveOpen(false)} />}
      {reportOpen && <ReportDialog targetType="template" targetId={templateId} onClose={() => setReportOpen(false)} />}
    </div>
  );
}

function SaveDialog({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const toast = useToast();
  const [cols, setCols] = useState<{ id: string; name: string; is_public: boolean; has: boolean }[] | null>(null);
  const [name, setName] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const db = browserClient();
      const { data: claims } = await db.auth.getClaims();
      const uid = claims?.claims?.sub;
      const [{ data: all }, { data: items }] = await Promise.all([
        db.from('collections').select('id, name, is_public').eq('owner_id', uid).order('created_at'),
        db.from('collection_items').select('collection_id').eq('template_id', templateId).eq('owner_id', uid),
      ]);
      const saved = new Set(((items ?? []) as { collection_id: string }[]).map((i) => i.collection_id));
      setCols(((all ?? []) as { id: string; name: string; is_public: boolean }[]).map((c) => ({ ...c, has: saved.has(c.id) })));
    })();
  }, [templateId]);

  const toggle = (id: string, has: boolean) => start(async () => {
    setCols((c) => c!.map((x) => (x.id === id ? { ...x, has } : x)));
    const r = await setInCollection(id, templateId, has);
    if (!r.ok) { setCols((c) => c!.map((x) => (x.id === id ? { ...x, has: !has } : x))); toast({ text: r.error, tone: 'error' }); }
    else if (has) toast({ text: `Saved to “${cols?.find((c) => c.id === id)?.name}”`, tone: 'ok' });
  });

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await createCollection(name, true);
      if (!r.ok) return toast({ text: r.error, tone: 'error' });
      await setInCollection(r.data.id, templateId, true);
      setCols((c) => [...(c ?? []), { id: r.data.id, name: name.trim(), is_public: true, has: true }]);
      setName('');
      toast({ text: `Saved to “${name.trim()}”`, tone: 'ok' });
    });
  };

  return (
    <Dialog open onClose={onClose} title="Save to collection">
      {!cols ? <div className="skeleton h-24" /> : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {cols.length === 0 && <li className="text-ink-2">No collections yet. Create your first one below.</li>}
          {cols.map((c) => (
            <li key={c.id}>
              <label className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-surface-2">
                <input type="checkbox" checked={c.has} disabled={pending} onChange={(e) => toggle(c.id, e.target.checked)} className="h-[18px] w-[18px] accent-[var(--accent)]" />
                <span className="flex-1">{c.name}</span>
                <span className="text-xs text-ink-3">{c.is_public ? 'Public' : 'Private'}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="flex gap-2">
        <label className="sr-only" htmlFor="new-collection">New collection name</label>
        <input id="new-collection" className="field" placeholder="New collection" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={pending || !name.trim()} className="btn btn-secondary">Create</button>
      </form>
    </Dialog>
  );
}

const REASONS: [string, string][] = [
  ['broken', 'Broken or doesn’t match the preview'], ['copyright', 'Copied from someone else (copyright)'],
  ['malware', 'Malware or suspicious files'], ['spam', 'Spam'], ['inappropriate', 'Inappropriate content'], ['other', 'Something else'],
];

export function ReportDialog({ targetType, targetId, onClose }: { targetType: 'template' | 'comment'; targetId: string; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await fileReport({ targetType, targetId, reason: reason as 'spam', details });
      if (!r.ok) return toast({ text: r.error, tone: 'error' });
      toast({ text: 'Thanks. A moderator will take a look.', tone: 'ok' });
      onClose();
    });
  };
  return (
    <Dialog open onClose={onClose} title={`Report this ${targetType}`}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="sr-only">Reason</legend>
          {REASONS.map(([v, l]) => (
            <label key={v} className="flex min-h-10 items-center gap-3 rounded-md px-2 hover:bg-surface-2">
              <input type="radio" name="reason" value={v} checked={reason === v} onChange={() => setReason(v)} className="h-4 w-4 accent-[var(--accent)]" />
              {l}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className="label">Details (optional)</span>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} className="field h-auto py-2.5" />
        </label>
        <button type="submit" disabled={!reason || pending} className="btn btn-primary">Send report</button>
      </form>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────── download
type DlState = { phase: 'idle' | 'preparing' | 'done' | 'error'; message?: string; url?: string };

export function DownloadPanel({ versions, files, currentVersionId, licenses, links }: {
  versions: TemplateVersion[]; files: TemplateFile[]; currentVersionId: string | null;
  licenses: License[]; links: LinkKind[];
}) {
  const { state, set, templateId, slug } = useViewer();
  const [versionId, setVersionId] = useState(currentVersionId ?? versions[0]?.id ?? '');
  const [accept, setAccept] = useState(false);
  const [dl, setDl] = useState<DlState>({ phase: 'idle' });
  const version = versions.find((v) => v.id === versionId);
  const latest = versions.find((v) => v.id === currentVersionId);
  const vFiles = files.filter((f) => f.version_id === versionId);
  const license = licenses.find((l) => l.code === version?.license_code) ?? null;
  const total = vFiles.reduce((n, f) => n + Number(f.size_bytes), 0);
  const needsAccept = Boolean(state?.uid && license && !state.licenseAccepted);

  async function download(file: TemplateFile) {
    setDl({ phase: 'preparing', message: `Preparing ${file.original_name}` });
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: file.id, acceptLicense: accept }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setDl({ phase: 'error', message: body.error ?? 'Download failed. Try again.' });
    set((s) => ({ ...s, licenseAccepted: true }));
    setDl({ phase: 'done', url: body.url });
    window.location.assign(body.url);
  }

  return (
    <section id="download" aria-labelledby="download-title" className="flex scroll-mt-24 flex-col gap-4 rounded-xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center justify-between gap-3">
        <h2 id="download-title" className="m-0 text-base font-semibold">Download</h2>
        {versions.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="sr-only">Version</span>
            <select value={versionId} onChange={(e) => { setVersionId(e.target.value); setDl({ phase: 'idle' }); }}
                    className="h-9 rounded-md bg-surface-2 px-2.5 font-mono text-xs text-ink shadow-[inset_0_0_0_1px_var(--line)]">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version}{v.id === currentVersionId ? ' • latest' : v.status === 'yanked' ? ' • yanked' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {version?.status === 'yanked' ? (
        <div role="status" className="flex flex-col gap-3 rounded-md bg-surface-2 p-3.5 text-[13px] text-ink-2">
          <span className="inline-flex items-start gap-2"><Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" />
            v{version.version} was pulled by the creator: {version.yank_reason}. Get the latest version instead.</span>
          {latest && <button type="button" className="btn btn-secondary h-10" onClick={() => setVersionId(latest.id)}>Switch to v{latest.version}</button>}
        </div>
      ) : (
        <>
          {vFiles.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {vFiles.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-md bg-surface-2 py-2 pr-2 pl-3">
                  <Icon name={f.ext === 'zip' ? 'folder' : 'file'} size={17} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12.5px]">{f.original_name}</span>
                    <span className="font-mono text-[11px] text-ink-3">{TOOL_LABEL[f.source_tool]} · {formatBytes(Number(f.size_bytes))}</span>
                  </span>
                  {state?.uid && (
                    <button type="button" disabled={dl.phase === 'preparing' || (needsAccept && !accept)} onClick={() => download(f)}
                            aria-label={`Download ${f.original_name}`} className="btn btn-primary h-9 px-3">
                      <Icon name="download" size={15} strokeWidth={2} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {license && (
            <div className="flex flex-col gap-2 border-t border-line pt-3.5 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-medium"><Icon name="shield" size={15} />{license.name}</span>
                <Link href="/legal/licenses" className="text-ink-3 underline-offset-4 hover:text-accent-ink hover:underline">What this means</Link>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name={license.allows_commercial ? 'check' : 'x'} size={14} strokeWidth={2.2} className={license.allows_commercial ? 'text-success' : 'text-danger'} />
                  Commercial use
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name={license.requires_attribution ? 'info' : 'check'} size={14} className="text-ink-3" />
                  {license.requires_attribution ? 'Attribution required' : 'No attribution needed'}
                </span>
              </div>
            </div>
          )}

          {state === null && <div className="skeleton h-11" />}
          {state && !state.uid && vFiles.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-[13px] text-ink-2">Downloads are free with an account.</p>
              <Link href={signInHref(slug)} className="btn btn-primary">Sign in to download</Link>
            </div>
          )}
          {needsAccept && vFiles.length > 0 && (
            <label className="flex items-start gap-2.5 rounded-md p-3 text-[13px] shadow-[inset_0_0_0_1px_var(--line)]">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[var(--accent)]" />
              <span>I accept the {LICENSE_SHORT[license!.code] ?? license!.name} license{license!.requires_attribution ? ' and will credit the creator' : ''}.</span>
            </label>
          )}
          {vFiles.length > 1 && state?.uid && (
            <p className="m-0 font-mono text-[11px] text-ink-3">{vFiles.length} files · {formatBytes(total)} total</p>
          )}
        </>
      )}

      {links.length > 0 && (
        <div className="flex flex-col gap-2">
          {links.map((k) => (
            <a key={k} href={`/go/${templateId}/${k}`} target="_blank" rel="noopener noreferrer nofollow ugc" className="btn btn-secondary">
              <Icon name={k === 'github' ? 'github' : 'external'} size={16} />
              {k === 'github' ? 'View on GitHub' : `Open in ${TOOL_LABEL[k]}`}
            </a>
          ))}
        </div>
      )}

      <div aria-live="polite" className="text-[13px]">
        {dl.phase === 'preparing' && <span className="text-ink-2">{dl.message}…</span>}
        {dl.phase === 'done' && <span className="text-ink-2">Download started. If nothing happens, <a href={dl.url} className="text-accent-ink underline">use this direct link</a>.</span>}
        {dl.phase === 'error' && <span role="alert" className="text-danger">{dl.message}</span>}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────── vote
export function VoteModule({ voteCount }: { voteCount: number }) {
  const { state, set, templateId, slug } = useViewer();
  const toast = useToast();
  const [count, setCount] = useState(voteCount);
  const [confirming, setConfirming] = useState(false);
  const [spent, setSpent] = useState(0); // bumps to replay the "-1" animation
  const [pending, start] = useTransition();

  const vote = () => start(async () => {
    const r = await castVote(templateId);
    setConfirming(false);
    if (!r.ok) {
      if (r.code === 'voted' || r.code === 'no_bits') set((s) => ({ ...s, eligibility: r.code as ViewerState['eligibility'] }));
      return toast({ text: r.error, tone: 'error' });
    }
    setCount(r.data.voteCount);
    setSpent((n) => n + 1);
    set((s) => ({ ...s, vote: { created_at: new Date().toISOString() }, balance: r.data.balance, eligibility: 'voted' }));
    window.dispatchEvent(new CustomEvent(YOWKBITS_EVENT, { detail: r.data.balance }));
    toast({ text: `Vote cast. ${r.data.balance} yowkbit${r.data.balance === 1 ? '' : 's'} left.`, tone: 'ok' });
  });

  return (
    <section aria-labelledby="vote-title" className="vote-panel relative flex flex-col gap-4 overflow-hidden rounded-xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="vote-title" className="m-0 text-base font-semibold">Votes</h2>
        <Link href="/ranking" className="text-[12.5px] text-ink-3 hover:text-accent-ink">Counts toward the Ranking</Link>
      </div>
      <div className="flex items-center gap-4">
        <span key={count} className="count-pop font-display text-[56px] leading-none" aria-live="polite">{formatCount(count)}</span>
        <p className="m-0 text-[13px] text-ink-2">
          Every vote costs its voter 1 yowkbit, so each one means something. Likes are free and don&apos;t affect the Ranking.
        </p>
      </div>
      {spent > 0 && (
        <span key={spent} aria-hidden="true" className="bit-spend pointer-events-none absolute right-6 bottom-16 inline-flex items-center gap-1 font-mono text-sm font-semibold text-accent-ink">
          <Icon name="bit" size={16} strokeWidth={2} />−1
        </span>
      )}

      <div className="border-t border-line pt-4 text-[13px]">
        {!state && <div className="skeleton h-12" />}
        {state?.eligibility === 'auth' && <Link href={signInHref(slug)} className="btn btn-secondary w-full">Sign in to vote</Link>}
        {state?.eligibility === 'own' && <p className="m-0 text-ink-2">You can&apos;t vote on your own work. Share it to collect votes.</p>}
        {state?.eligibility === 'too_new' && <p className="m-0 text-ink-2">New accounts can vote 24 hours after signing up. It keeps the Ranking fair.</p>}
        {state?.eligibility === 'unverified' && <p className="m-0 text-ink-2">Verify your email address to vote.</p>}
        {state?.eligibility === 'not_published' && <p className="m-0 text-ink-2">Voting opens once this template is published.</p>}
        {state?.eligibility === 'no_bits' && <p className="m-0 text-ink-2">You&apos;ve spent all your yowkbits. Likes and saves are still free.</p>}
        {state?.eligibility === 'voted' && (
          <p className="m-0 flex items-center gap-2 text-ink-2" role="status">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-on-accent"><Icon name="check" size={14} strokeWidth={2.4} /></span>
            You voted for this{state.vote ? ` on ${formatShortDate(state.vote.created_at)}` : ''}. Votes are final.
          </p>
        )}
        {state?.eligibility === 'ok' && !confirming && (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setConfirming(true)} className="btn btn-primary btn-lg vote-cta w-full">
              <Icon name="bit" size={18} strokeWidth={2} />Vote · 1 yowkbit
            </button>
            <p className="m-0 text-center text-ink-3">You have <span className="font-mono text-ink">{state.balance}</span> yowkbit{state.balance === 1 ? '' : 's'}.</p>
          </div>
        )}
        {state?.eligibility === 'ok' && confirming && (
          <div className="flex flex-col gap-3" role="group" aria-labelledby="vote-confirm">
            <p id="vote-confirm" className="m-0 text-ink">Spend 1 of your {state.balance} yowkbits on this template? Votes are final.</p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>Cancel</button>
              <button type="button" className="btn btn-primary flex-1" onClick={vote} disabled={pending} autoFocus>
                {pending ? 'Voting…' : 'Confirm vote'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
