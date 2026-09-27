'use client';
import Link from 'next/link';
import { createContext, useContext, useEffect, useMemo, useState, useTransition } from 'react';
import { useViewerState, type ViewerState } from './viewer-state';
import { Icon } from '../icons';
import { Dialog } from '../dialog';
import { useToast } from '../toast';
import { setFollow, setLike, submitVote, fileReport } from '@/app/actions/engagement';
import { createCollection, setInCollection } from '@/app/actions/collections';
import { browserClient } from '@/lib/supabase/browser';
import { formatBytes, formatCompact, formatCount, formatShortDate } from '@/lib/format';
import { TOOL_LABEL, LICENSE_SHORT, MIN_VOTES_FOR_SCORE } from '@/lib/labels';
import type { TemplateFile, TemplateVersion, Breakdown } from '@/lib/data/template';
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
              aria-label={`${liked ? 'Unlike' : 'Like'}, ${formatCount(likeCount + delta)} likes`}
              className={`btn btn-secondary h-10 px-3.5 ${liked ? 'text-accent-ink' : ''}`}>
        <Icon name="heart" size={17} filled={liked} className={`shrink-0 transition-transform ${liked ? 'scale-110' : ''}`} />
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
type Criterion = 'design' | 'usability' | 'creativity' | 'code_quality';
const CRITERIA: [Criterion, string][] = [['design', 'Design'], ['usability', 'Usability'], ['creativity', 'Creativity'], ['code_quality', 'Code quality']];

export function VoteModule({ score, breakdown, hasCode }: { score: number | null; breakdown: Breakdown; hasCode: boolean }) {
  const { state, set, templateId, slug } = useViewer();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<Criterion, number>>>({});
  const [pending, start] = useTransition();
  const criteria = CRITERIA.filter(([k]) => hasCode || k !== 'code_quality');
  const complete = criteria.every(([k]) => draft[k]);
  const shown = breakdown.votes >= MIN_VOTES_FOR_SCORE && score != null;
  const avgs: Record<Criterion, number | null> = { design: breakdown.design, usability: breakdown.usability, creativity: breakdown.creativity, code_quality: breakdown.code };

  const startEdit = () => {
    const v = state?.vote;
    setDraft(v ? { design: v.design, usability: v.usability, creativity: v.creativity, code_quality: v.code_quality ?? undefined } : {});
    setEditing(true);
  };
  const submit = () => start(async () => {
    const r = await submitVote({
      templateId, design: draft.design!, usability: draft.usability!, creativity: draft.creativity!,
      codeQuality: hasCode ? draft.code_quality ?? null : null,
    });
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    set((s) => ({ ...s, vote: { design: draft.design!, usability: draft.usability!, creativity: draft.creativity!, code_quality: draft.code_quality ?? null, updated_at: new Date().toISOString() } }));
    setEditing(false);
    toast({ text: r.data.updated ? 'Vote updated.' : 'Your vote is in. Thanks for rating.', tone: 'ok' });
  });

  return (
    <section aria-labelledby="vote-title" className="flex flex-col gap-4 rounded-xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-baseline justify-between">
        <h2 id="vote-title" className="m-0 text-base font-semibold">Community score</h2>
        <span className="font-mono text-xs text-ink-3">{formatCount(breakdown.votes)} vote{breakdown.votes === 1 ? '' : 's'}{!hasCode ? ' · design-only' : ''}</span>
      </div>
      {shown ? (
        <div className="flex items-center gap-5">
          <span className="font-display text-[56px] leading-none">{Number(score).toFixed(1)}</span>
          <dl className="m-0 grid flex-1 gap-1.5">
            {criteria.map(([k, label]) => (
              <div key={k} className="grid grid-cols-[88px_1fr_28px] items-center gap-2 text-[12.5px]">
                <dt className="text-ink-2">{label}</dt>
                <dd className="m-0 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${((avgs[k] ?? 0) / 10) * 100}%` }} />
                </dd>
                <dd className="m-0 text-right font-mono">{avgs[k]?.toFixed(1) ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">
          <span className="mr-2 font-display text-4xl text-ink-3">—</span>
          Score appears after {MIN_VOTES_FOR_SCORE} votes. {breakdown.votes} so far.
        </p>
      )}

      <div className="border-t border-line pt-4">
        {!state && <div className="skeleton h-10" />}
        {state?.eligibility === 'auth' && <Link href={signInHref(slug)} className="btn btn-secondary w-full">Sign in to vote</Link>}
        {state?.eligibility === 'own' && <p className="m-0 text-[13px] text-ink-2">You can&apos;t vote on your own work. Share it to collect votes.</p>}
        {state?.eligibility === 'too_new' && <p className="m-0 text-[13px] text-ink-2">New accounts can vote after 7 days. It keeps the awards fair.</p>}
        {state?.eligibility === 'unverified' && <p className="m-0 text-[13px] text-ink-2">Verify your email address to vote.</p>}
        {state?.eligibility === 'ok' && state.vote && !editing && (
          <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2" role="status">
            <span>You rated this on {formatShortDate(state.vote.updated_at)}.</span>
            <button type="button" onClick={startEdit} className="btn btn-secondary h-9 px-3">Edit your vote</button>
          </div>
        )}
        {state?.eligibility === 'ok' && (!state.vote || editing) && (
          <div className="flex flex-col gap-3.5">
            <h3 className="m-0 text-sm font-semibold">Your vote</h3>
            {criteria.map(([k, label]) => (
              <fieldset key={k} className="m-0 flex flex-col gap-1.5 border-0 p-0">
                <legend className="mb-1.5 flex w-full justify-between text-[13px]">
                  <span>{label}</span><span className="font-mono text-ink-3">{draft[k] ?? '–'}</span>
                </legend>
                <div className="grid grid-cols-10 gap-1">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <label key={n} className="relative">
                      <input type="radio" name={`vote-${k}`} value={n} checked={draft[k] === n} className="peer sr-only"
                             onChange={() => setDraft((d) => ({ ...d, [k]: n }))} />
                      <span className={`flex h-9 cursor-pointer items-center justify-center rounded-sm font-mono text-xs transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                        draft[k] && n <= draft[k]! ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'}`}>{n}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="flex gap-2">
              {editing && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}
              <button type="button" disabled={!complete || pending} onClick={submit} className="btn btn-primary flex-1">
                {complete ? (pending ? 'Submitting…' : 'Submit vote') : `Rate all ${criteria.length} to submit`}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
