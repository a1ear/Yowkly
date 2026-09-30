'use client';
import { useRef, useState } from 'react';
import { startPostImageUpload } from '@/app/actions/posts';
import { putWithProgress } from '@/lib/upload-client';
import { shrinkImage } from '@/lib/image-shrink';
import { mediaUrl } from '@/lib/labels';
import { Dialog } from './dialog';
import { Icon } from './icons';
import { ImageCropper, type CropShape } from './image-cropper';
import { useToast } from './toast';

export const MAX_POST_IMAGES = 4;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const SHAPES: CropShape[] = [
  { label: 'Original', aspect: null }, { label: 'Square', aspect: 1 }, { label: '4:5', aspect: 4 / 5 }, { label: '16:9', aspect: 16 / 9 },
];

export type PostImageDraft = {
  key: string; preview: string; state: 'uploading' | 'ready' | 'failed';
  progress: number; path?: string; width?: number; height?: number; alt: string;
};
export type PostImage = { path: string; alt: string | null; width: number | null; height: number | null };

/**
 * Picks, crops, shrinks and uploads post images as soon as they're chosen, so
 * pressing Post is instant. Each one goes to a path the database issued
 * (prepare_post_image); create_post then attaches only the caller's own images.
 */
export function PostImagePicker({ images, setImages }: {
  images: PostImageDraft[];
  setImages: (fn: (list: PostImageDraft[]) => PostImageDraft[]) => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const patch = (key: string, p: Partial<PostImageDraft>) => setImages((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const upload = async (file: File) => {
    const key = crypto.randomUUID();
    const preview = URL.createObjectURL(file);
    setImages((list) => [...list, { key, preview, state: 'uploading', progress: 0, alt: '' }]);
    try {
      const img = await shrinkImage(file, 1600);
      const start = await startPostImageUpload(img.type, img.blob.size);
      if (!start.ok) throw new Error(start.error);
      await putWithProgress(start.data.url, img.blob, img.type, (sent) => patch(key, { progress: sent / img.blob.size })).done;
      patch(key, { state: 'ready', progress: 1, path: start.data.path, width: img.width, height: img.height });
    } catch (e) {
      patch(key, { state: 'failed' });
      toast({ text: e instanceof Error ? e.message : 'Upload failed. Try again.', tone: 'error' });
    }
  };

  const pick = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_POST_IMAGES - images.length;
    const list = Array.from(files).slice(0, room);
    if (files.length > room) toast({ text: `A post can have up to ${MAX_POST_IMAGES} images.`, tone: 'error' });
    const ok = list.filter((f) => {
      if (!TYPES.includes(f.type)) { toast({ text: 'Use PNG, JPG, WebP or GIF images.', tone: 'error' }); return false; }
      if (f.size > 20 * 1024 * 1024) { toast({ text: 'Images can be up to 20 MB before compression.', tone: 'error' }); return false; }
      return true;
    });
    // GIFs upload as they are (a crop would freeze them); the rest are cropped one by one.
    for (const f of ok.filter((f) => f.type === 'image/gif')) upload(f);
    setQueue((q) => [...q, ...ok.filter((f) => f.type !== 'image/gif')]);
  };

  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
          {images.map((i) => (
            <li key={i.key} className="relative flex flex-col gap-1.5 rounded-lg bg-surface-2 p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={i.preview} alt="" className={`aspect-[4/3] w-full rounded-md object-cover ${i.state === 'uploading' ? 'opacity-60' : ''} ${i.state === 'failed' ? 'opacity-30' : ''}`} />
              {i.state === 'uploading' && (
                <span className="absolute inset-x-3 top-[calc(50%-14px)] h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Uploading" aria-valuenow={Math.round(i.progress * 100)}>
                  <span className="block h-full bg-accent transition-[width]" style={{ width: `${Math.round(i.progress * 100)}%` }} />
                </span>
              )}
              {i.state === 'failed' && <span className="absolute inset-x-0 top-[calc(50%-20px)] text-center text-[12px] text-danger">Upload failed</span>}
              <button type="button" aria-label="Remove image" onClick={() => { URL.revokeObjectURL(i.preview); setImages((list) => list.filter((x) => x.key !== i.key)); }}
                      className="absolute top-2.5 right-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(15,14,12,.75)] text-[#F2EFE8] hover:bg-[rgba(15,14,12,.9)]">
                <Icon name="x" size={14} />
              </button>
              <label className="sr-only" htmlFor={`alt-${i.key}`}>Describe this image (optional)</label>
              <input id={`alt-${i.key}`} value={i.alt} maxLength={250} onChange={(e) => patch(i.key, { alt: e.target.value })}
                     placeholder="Describe it (optional)" className="field h-8 text-[12.5px]" />
            </li>
          ))}
        </ul>
      )}
      {images.length < MAX_POST_IMAGES && (
        <button type="button" onClick={() => input.current?.click()} className="btn btn-ghost h-10 self-start px-3 text-[13.5px]">
          <Icon name="camera" size={17} />Add photos <span className="text-ink-3">({images.length}/{MAX_POST_IMAGES})</span>
        </button>
      )}
      <input ref={input} type="file" accept={TYPES.join(',')} multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
      {queue[0] && (
        <ImageCropper key={queue[0].name + queue[0].size + queue.length} file={queue[0]} shapes={SHAPES} title="Crop image"
                      onDone={(f) => { setQueue((q) => q.slice(1)); upload(f); }}
                      onCancel={() => setQueue((q) => q.slice(1))} />
      )}
    </div>
  );
}

/** Images on a post: 1 large, 2 side by side, 3–4 in a grid. Click to see one full size. */
export function PostImageGrid({ images, author }: { images: PostImage[]; author: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length) return null;
  const n = images.length;
  const alt = (i: PostImage, idx: number) => i.alt || `Image ${idx + 1} shared by ${author}`;
  return (
    <>
      <div className={`grid gap-1.5 overflow-hidden rounded-xl ${n === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {images.map((img, idx) => (
          <button key={img.path} type="button" onClick={() => setOpen(idx)} aria-label={`Open ${alt(img, idx)}`}
                  className={`relative overflow-hidden bg-surface-2 ${n === 1 ? 'max-h-[520px]' : 'aspect-square'} ${n === 3 && idx === 0 ? 'row-span-2 aspect-auto' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(img.path)} alt={alt(img, idx)} loading="lazy" decoding="async"
                 width={img.width ?? undefined} height={img.height ?? undefined}
                 className={`h-full w-full ${n === 1 ? 'max-h-[520px] object-contain' : 'object-cover'} transition-transform duration-300 hover:scale-[1.02]`} />
          </button>
        ))}
      </div>
      {open !== null && (
        <Dialog open onClose={() => setOpen(null)} title={`Image ${open + 1} of ${n}`} width={1100}>
          <div className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(images[open].path)} alt={alt(images[open], open)} className="max-h-[75vh] w-full rounded-lg object-contain" />
            {images[open].alt && <p className="m-0 text-[13px] text-ink-2">{images[open].alt}</p>}
            {n > 1 && (
              <div className="flex justify-between gap-2">
                <button type="button" onClick={() => setOpen((open + n - 1) % n)} className="btn btn-secondary"><Icon name="chevronLeft" size={16} />Previous</button>
                <button type="button" onClick={() => setOpen((open + 1) % n)} className="btn btn-secondary">Next<Icon name="chevronRight" size={16} /></button>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
