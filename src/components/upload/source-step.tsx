'use client';
import Link from 'next/link';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { registerUpload, removeFile, saveLinks, startFileUpload } from '@/app/actions/upload';
import { putWithProgress } from '@/lib/upload-client';
import { useToast } from '../toast';
import { Icon } from '../icons';
import { formatBytes } from '@/lib/format';
import type { DraftFile } from '@/lib/data/draft';
import type { LinkKind } from '@/lib/types';

const EXTS = ['zip', 'fig', 'psd', 'ai', 'sketch', 'xd', 'penpot', 'pdf'];
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 5;

type Row =
  | { kind: 'saved'; file: DraftFile }
  | { kind: 'uploading'; key: string; name: string; size: number; sent: number; abort: () => void }
  | { kind: 'failed'; key: string; name: string; size: number; error: string };

const LINK_FIELDS: [LinkKind, string, string][] = [
  ['figma', 'Figma', 'https://www.figma.com/community/file/…'],
  ['canva', 'Canva', 'https://www.canva.com/design/…/view'],
  ['github', 'GitHub', 'https://github.com/you/repo'],
  ['framer', 'Framer', 'https://framer.com/projects/…'],
  ['webflow', 'Webflow', 'https://webflow.com/made-in-webflow/website/…'],
  ['penpot', 'Penpot', 'https://design.penpot.app/…'],
];

export function SourceStep({ templateId, versionId, files, links, demoUrl }: {
  templateId: string; versionId: string; files: DraftFile[];
  links: { kind: LinkKind; url: string }[]; demoUrl: string | null;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(files.map((file) => ({ kind: 'saved', file })));
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [linkState, linkAction, linkPending] = useActionState(saveLinks.bind(null, templateId), null);

  const patch = useCallback((key: string, fn: (r: Row) => Row) =>
    setRows((all) => all.map((r) => ('key' in r && r.key === key) || (r.kind === 'saved' && r.file.id === key) ? fn(r) : r)), []);

  // Poll scan status for files that are still being checked.
  const waiting = rows.filter((r) => r.kind === 'saved' && ['pending', 'scanning'].includes(r.file.scan_status)).map((r) => (r as { file: DraftFile }).file.id);
  const waitingKey = waiting.join(',');
  useEffect(() => {
    if (!waitingKey) return;
    const id = setInterval(async () => {
      const { data } = await browserClient().from('template_files')
        .select('id, original_name, ext, size_bytes, source_tool, scan_status, reject_reason, created_at').in('id', waitingKey.split(','));
      for (const f of (data ?? []) as DraftFile[]) patch(f.id, () => ({ kind: 'saved', file: f }));
    }, 3000);
    return () => clearInterval(id);
  }, [waitingKey, patch]);

  async function add(list: FileList | null) {
    if (!list) return;
    let count = rows.filter((r) => r.kind !== 'failed').length;
    for (const file of Array.from(list)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const key = crypto.randomUUID();
      const failRow = (error: string) => ({ kind: 'failed' as const, key, name: file.name, size: file.size, error });
      const fail = (error: string) => setRows((all) => [...all, failRow(error)]);
      // Friendly early checks; Postgres enforces the same rules in prepare_file_upload.
      if (!EXTS.includes(ext)) { fail(`.${ext} files aren't supported. Use ${EXTS.map((e) => '.' + e).join(' ')}.`); continue; }
      if (file.size > MAX_BYTES) { fail('Files can be up to 200 MB.'); continue; }
      if (count >= MAX_FILES) { fail('A version can have at most 5 files.'); continue; }
      count++;
      upload(file, ext, key, failRow);
    }
  }

  async function upload(file: File, ext: string, key: string, failRow: (e: string) => Row) {
    setRows((all) => [...all, { kind: 'uploading', key, name: file.name, size: file.size, sent: 0, abort: () => {} }]);
    const start = await startFileUpload(versionId, file.name, file.size);
    if (!start.ok) return patch(key, () => failRow(start.error));
    const put = putWithProgress(start.data.url, file, 'application/octet-stream',
      (sent) => patch(key, (r) => (r.kind === 'uploading' ? { ...r, sent } : r)));
    patch(key, (r) => (r.kind === 'uploading' ? { ...r, abort: put.abort } : r));
    try {
      await put.done;
    } catch (e) {
      if ((e as Error).message === 'aborted') return;
      return patch(key, () => failRow((e as Error).message));
    }
    const res = await registerUpload(versionId, start.data.path, file.name, file.size);
    if (!res.ok) return patch(key, () => failRow(res.error));
    patch(key, () => ({
      kind: 'saved',
      file: { id: res.data.id, original_name: file.name, ext, size_bytes: file.size, source_tool: 'code', scan_status: 'pending', reject_reason: null, created_at: new Date().toISOString() },
    }));
  }

  const remove = async (r: Row) => {
    if (r.kind === 'uploading') { r.abort(); setRows((all) => all.filter((x) => x !== r)); return; }
    if (r.kind === 'failed') { setRows((all) => all.filter((x) => x !== r)); return; }
    const res = await removeFile(r.file.id);
    if (!res.ok) return toast({ text: res.error, tone: 'error' });
    setRows((all) => all.filter((x) => x !== r));
  };

  const uploading = rows.filter((r) => r.kind === 'uploading').length;
  const attention = rows.filter((r) => r.kind === 'failed' || (r.kind === 'saved' && ['infected', 'rejected'].includes(r.file.scan_status))).length;
  const linkValue = (k: LinkKind) => links.find((l) => l.kind === k)?.url ?? '';

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="files-title" className="flex flex-col gap-4">
        <div>
          <h2 id="files-title" className="m-0 text-lg font-semibold">Upload files</h2>
          <p className="m-0 text-[13px] text-ink-2">ZIP, Figma, PSD, AI, Sketch, XD, Penpot or PDF. Every file is scanned for malware before anyone can download it.</p>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${drag ? 'border-accent bg-surface-2' : 'border-line'}`}
        >
          <Icon name="upload" size={24} className="text-ink-3" />
          <p className="m-0">Drag files here, or{' '}
            <button type="button" onClick={() => inputRef.current?.click()} className="font-semibold text-accent-ink underline underline-offset-4">browse</button>
          </p>
          <p className="m-0 font-mono text-[11px] text-ink-3">{EXTS.map((e) => '.' + e).join(' ')} · up to 200 MB each · 5 files per version</p>
          <input ref={inputRef} type="file" multiple hidden accept={EXTS.map((e) => '.' + e).join(',')} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </div>

        {rows.length > 0 && (
          <ul aria-label="Files" className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((r) => {
              const name = r.kind === 'saved' ? r.file.original_name : r.name;
              const size = r.kind === 'saved' ? Number(r.file.size_bytes) : r.size;
              return (
                <li key={r.kind === 'saved' ? r.file.id : r.key} className="flex flex-col gap-2 rounded-lg bg-surface-1 px-4 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
                  <div className="flex items-center gap-3">
                    <Icon name={name.endsWith('.zip') ? 'folder' : 'file'} size={18} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{name}</span>
                    <span className="font-mono text-[12px] text-ink-3">{formatBytes(size)}</span>
                    <FileStatus row={r} />
                    <button type="button" aria-label={`Remove ${name}`} onClick={() => remove(r)} className="btn btn-ghost h-9 w-9 px-0"><Icon name="x" size={15} /></button>
                  </div>
                  {r.kind === 'uploading' && (
                    <div role="progressbar" aria-label={`Uploading ${name}`} aria-valuenow={Math.round((r.sent / r.size) * 100)} aria-valuemin={0} aria-valuemax={100}
                         className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(r.sent / r.size) * 100}%` }} />
                    </div>
                  )}
                  {(r.kind === 'failed' || (r.kind === 'saved' && r.file.reject_reason)) && (
                    <p role="alert" className="m-0 text-[13px] text-danger">{r.kind === 'failed' ? r.error : r.file.reject_reason} Remove it and upload again.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form action={linkAction} className="flex flex-col gap-6">
        <section aria-labelledby="links-title" className="flex flex-col gap-4">
          <div>
            <h2 id="links-title" className="m-0 text-lg font-semibold">Links</h2>
            <p className="m-0 text-[13px] text-ink-2">Canva has no editable file export, so Canva templates are shared as a link. Figma and GitHub links work alongside or instead of files.</p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="label">Live demo URL <span className="font-normal text-ink-3">(optional, shown in a sandboxed preview)</span></span>
            <input name="demo" type="url" inputMode="url" defaultValue={demoUrl ?? ''} placeholder="https://your-demo.example.com" className="field" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            {LINK_FIELDS.map(([k, label, ph]) => (
              <label key={k} className="flex flex-col gap-1.5">
                <span className="label">{label}</span>
                <input name={`link_${k}`} type="url" inputMode="url" defaultValue={linkValue(k)} placeholder={ph} className="field" />
              </label>
            ))}
          </div>
        </section>
        {linkState?.error && <p role="alert" className="m-0 flex items-center gap-2 text-danger"><Icon name="alert" size={16} />{linkState.error}</p>}
        <div className="sticky bottom-16 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/95 py-4 md:bottom-0">
          <Link href={`/upload/${templateId}?step=1`} className="btn btn-ghost">Back</Link>
          <span className="text-[13px] text-ink-3" aria-live="polite">
            {[uploading && `${uploading} uploading`, attention && `${attention} need${attention === 1 ? 's' : ''} attention`].filter(Boolean).join(', ')}
          </span>
          <button className="btn btn-primary" disabled={linkPending}>{linkPending ? 'Saving…' : 'Continue to Media'}<Icon name="arrowRight" size={16} /></button>
        </div>
      </form>
    </div>
  );
}

function FileStatus({ row }: { row: Row }) {
  if (row.kind === 'uploading') {
    const pct = Math.round((row.sent / row.size) * 100);
    return <span className="font-mono text-[12px] text-ink-2">{pct}%</span>;
  }
  if (row.kind === 'failed') return <Pill tone="danger" icon="x" label="Failed" />;
  switch (row.file.scan_status) {
    case 'pending':
    case 'scanning': return <Pill tone="info" icon="shield" label="Scanning for malware" />;
    case 'clean': return <Pill tone="success" icon="check" label="Clean" />;
    default: return <Pill tone="danger" icon="x" label="Rejected" />;
  }
}

function Pill({ tone, icon, label }: { tone: 'success' | 'danger' | 'info'; icon: 'check' | 'x' | 'shield'; label: string }) {
  const color = { success: 'text-success', danger: 'text-danger', info: 'text-info' }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-[12px] ${color}`}><Icon name={icon} size={13} strokeWidth={2.2} />{label}</span>;
}
