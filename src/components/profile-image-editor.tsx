'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';
import { setProfileImage } from '@/app/actions/profile';
import { useToast } from './toast';
import { Icon } from './icons';
import { ImageCropper } from './image-cropper';

const SIZE = { avatar: [400, 400], cover: [1500, 500] } as const;
const MAX_INPUT = 20 * 1024 * 1024;

/**
 * Center-crop and resize in the browser before uploading, so a 12 MB phone
 * photo becomes a ~200 KB image: fast on slow connections and well under the
 * bucket's 2 MB limit. WebP where the browser can encode it, JPEG otherwise.
 */
export async function prepare(file: File, kind: 'avatar' | 'cover') {
  const bmp = await createImageBitmap(file);
  const [tw, th] = SIZE[kind];
  const scale = Math.max(tw / bmp.width, th / bmp.height);
  const sw = tw / scale;
  const sh = th / scale;
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  canvas.getContext('2d')!.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, tw, th);
  bmp.close();
  const encode = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.86));
  const webp = await encode('image/webp');
  if (webp?.type === 'image/webp') return { blob: webp, ext: 'webp', type: 'image/webp' };
  const jpg = await encode('image/jpeg');
  if (!jpg) throw new Error('Could not process that image.');
  return { blob: jpg, ext: 'jpg', type: 'image/jpeg' };
}

/** Owner-only controls to change or remove the avatar or cover photo. Renders nothing for visitors. */
export function ProfileImageEditor({ userId, kind, hasImage }: { userId: string; kind: 'avatar' | 'cover'; hasImage: boolean }) {
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    (async () => {
      const { data } = await browserClient().auth.getClaims();
      setOwner(data?.claims?.sub === userId);
    })();
  }, [userId]);
  if (!owner) return null;

  const label = kind === 'avatar' ? 'profile photo' : 'cover photo';

  const choose = (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast({ text: 'Use a PNG, JPEG or WebP image.', tone: 'error' });
    if (file.size > MAX_INPUT) return toast({ text: 'That image is over 20 MB.', tone: 'error' });
    setCropping(file);
  };

  const upload = async (file: File) => {
    setCropping(null);
    setBusy('Uploading…');
    try {
      const img = await prepare(file, kind);
      const path = `${userId}/${kind}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.${img.ext}`;
      const db = browserClient();
      const up = await db.storage.from('avatars').upload(path, img.blob, { contentType: img.type, cacheControl: '31536000', upsert: false });
      if (up.error) throw new Error(up.error.message);
      const r = await setProfileImage(kind, path);
      if (!r.ok) {
        await db.storage.from('avatars').remove([path]);
        throw new Error(r.error);
      }
      toast({ text: `New ${label} saved.`, tone: 'ok' });
      router.refresh();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : `Could not update your ${label}.`, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('Removing…');
    const r = await setProfileImage(kind, null);
    setBusy(null);
    if (!r.ok) return toast({ text: r.error, tone: 'error' });
    toast({ text: `${label[0].toUpperCase()}${label.slice(1)} removed.`, tone: 'ok' });
    router.refresh();
  };

  const picker = (
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true"
           onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) choose(f); }} />
  );
  const cropper = cropping && (
    <ImageCropper file={cropping} round={kind === 'avatar'} title={kind === 'avatar' ? 'Crop profile photo' : 'Crop cover photo'}
                  shapes={[{ label: kind === 'avatar' ? 'Square' : 'Cover (3:1)', aspect: kind === 'avatar' ? 1 : 3 }]}
                  onDone={upload} onCancel={() => setCropping(null)} />
  );

  if (kind === 'avatar') {
    return (
      <>
        {picker}
        {cropper}
        <button type="button" onClick={() => input.current?.click()} disabled={Boolean(busy)} aria-label={busy ?? 'Change profile photo'}
                title="Change profile photo"
                className="absolute right-1 bottom-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink shadow-[0_0_0_3px_var(--canvas)] transition-transform hover:scale-105 hover:bg-surface-3 disabled:opacity-70">
          {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-3 border-t-accent" /> : <Icon name="camera" size={18} />}
        </button>
      </>
    );
  }
  return (
    <div className="absolute right-3 bottom-3 flex gap-2 md:right-5 md:bottom-5">
      {picker}
      {cropper}
      {hasImage && !busy && (
        <button type="button" onClick={remove} className="btn h-10 bg-[rgba(15,14,12,.7)] px-3.5 text-[#F2EFE8] backdrop-blur hover:bg-[rgba(15,14,12,.85)]">
          <Icon name="trash" size={16} /><span className="hidden sm:inline">Remove</span>
        </button>
      )}
      <button type="button" onClick={() => input.current?.click()} disabled={Boolean(busy)}
              className="btn h-10 bg-[rgba(15,14,12,.7)] px-3.5 text-[#F2EFE8] backdrop-blur hover:bg-[rgba(15,14,12,.85)]">
        <Icon name="camera" size={16} />{busy ?? (hasImage ? 'Edit cover photo' : 'Add cover photo')}
      </button>
    </div>
  );
}
