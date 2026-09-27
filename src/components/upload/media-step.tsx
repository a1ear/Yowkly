'use client';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { registerMedia, removeMedia, startMediaUpload, updateMediaAlt } from '@/app/actions/upload';
import { putWithProgress } from '@/lib/upload-client';
import { useToast } from '../toast';
import { Icon } from '../icons';
import { mediaUrl } from '@/lib/labels';
import type { DraftMedia } from '@/lib/data/draft';

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'];

async function dimensions(file: File) {
  const bmp = await createImageBitmap(file);
  const d = { width: bmp.width, height: bmp.height };
  bmp.close();
  return d;
}

export function MediaStep({ templateId, media, isMobile }: { templateId: string; media: DraftMedia[]; isMobile: boolean }) {
  const cover = media.find((m) => m.kind === 'cover');
  const rest = media.filter((m) => m.kind !== 'cover');
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="m-0 text-lg font-semibold">Cover image <span className="font-normal text-danger">*</span></h2>
          <p className="m-0 text-[13px] text-ink-2">Shown on cards and at the top of your page. 1600×1000 or larger works best. PNG, JPG, WebP, AVIF or GIF up to 10 MB.</p>
        </div>
        {cover ? <MediaItem m={cover} /> : null}
        <AddImage templateId={templateId} kind="cover" label={cover ? 'Replace cover' : 'Add cover'} />
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="m-0 text-lg font-semibold">{isMobile ? 'App screens' : 'Gallery'}</h2>
          <p className="m-0 text-[13px] text-ink-2">Up to 11 more images. {isMobile ? 'Screens are shown in phone frames.' : 'Show key pages and states.'}</p>
        </div>
        {rest.length > 0 && <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">{rest.map((m) => <li key={m.id}><MediaItem m={m} /></li>)}</ul>}
        {media.length < 12 && <AddImage templateId={templateId} kind={isMobile ? 'mobile_screen' : 'gallery'} label={isMobile ? 'Add a screen' : 'Add an image'} />}
      </section>

      <div className="sticky bottom-16 flex justify-between gap-2 border-t border-line bg-canvas/95 py-4 md:bottom-0">
        <Link href={`/upload/${templateId}?step=2`} className="btn btn-ghost">Back</Link>
        <Link href={`/upload/${templateId}?step=4`} className="btn btn-primary">Continue to License<Icon name="arrowRight" size={16} /></Link>
      </div>
    </div>
  );
}

function AddImage({ templateId, kind, label }: { templateId: string; kind: 'cover' | 'gallery' | 'mobile_screen'; label: string }) {
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [alt, setAlt] = useState('');
  const [pending, start] = useTransition();

  const pick = (f?: File) => {
    if (!f) return;
    if (!TYPES.includes(f.type)) return toast({ text: 'Use a PNG, JPG, WebP, AVIF or GIF image.', tone: 'error' });
    if (f.size > 10 * 1024 * 1024) return toast({ text: 'Images can be up to 10 MB.', tone: 'error' });
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = () => start(async () => {
    if (!file) return;
    if (alt.trim().length < 3) return toast({ text: 'Describe the image in a few words (alt text).', tone: 'error' });
    const { width, height } = await dimensions(file);
    const start = await startMediaUpload(templateId, file.type, file.size);
    if (!start.ok) return toast({ text: start.error, tone: 'error' });
    try {
      await putWithProgress(start.data.url, file, file.type, () => {}).done;
    } catch {
      return toast({ text: 'Upload failed. Try again.', tone: 'error' });
    }
    const r = await registerMedia({ templateId, path: start.data.path, kind, device: kind === 'mobile_screen' ? 'mobile' : 'desktop', alt, width, height });
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    setFile(null); setPreview(null); setAlt('');
    router.refresh();
  });

  if (!file) {
    return (
      <div>
        <button type="button" onClick={() => input.current?.click()} className="btn btn-secondary"><Icon name="plus" size={16} />{label}</button>
        <input ref={input} type="file" accept={TYPES.join(',')} hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-1 p-4 shadow-[inset_0_0_0_1px_var(--line)] sm:flex-row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview && <img src={preview} alt="" className="aspect-[16/10] w-full rounded-md object-cover sm:w-56" />}
      <div className="flex flex-1 flex-col gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="label">Alt text <span className="text-danger">*</span></span>
          <input value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={250} className="field" placeholder="Dark analytics dashboard with an MRR line chart" autoFocus />
          <span className="text-[12px] text-ink-3">Describes the image for people using screen readers, and for search.</span>
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={pending} className="btn btn-primary">{pending ? 'Uploading…' : 'Save image'}</button>
          <button type="button" onClick={() => { setFile(null); setPreview(null); }} className="btn btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function MediaItem({ m }: { m: DraftMedia }) {
  const toast = useToast();
  const router = useRouter();
  const [alt, setAlt] = useState(m.alt_text);
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-3 rounded-xl bg-surface-1 p-3 shadow-[inset_0_0_0_1px_var(--line)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl(m.path)} alt={m.alt_text} className={`${m.kind === 'mobile_screen' ? 'aspect-[9/19] w-16' : 'aspect-[16/10] w-40'} shrink-0 rounded-md object-cover`} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">Alt text</span>
          <input value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={250} className="field h-9"
                 onBlur={() => alt !== m.alt_text && start(async () => {
                   const r = await updateMediaAlt(m.id, alt);
                   if (!r.ok) { toast({ text: r.error, tone: 'error' }); setAlt(m.alt_text); }
                 })} />
        </label>
        <button type="button" disabled={pending} className="btn btn-ghost h-8 self-start px-2 text-[13px] text-danger"
                onClick={() => start(async () => {
                  const r = await removeMedia(m.id);
                  if (!r.ok) toast({ text: r.error, tone: 'error' }); else router.refresh();
                })}>
          <Icon name="trash" size={14} />Remove
        </button>
      </div>
    </div>
  );
}
