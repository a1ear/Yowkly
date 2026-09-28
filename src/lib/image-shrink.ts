/**
 * Shrink an image in the browser before upload: longest side capped at
 * `maxEdge`, re-encoded as WebP (JPEG where the browser can't encode WebP).
 * A 6 MB PNG screenshot typically becomes 100–300 KB, which is what makes
 * card grids fast on slow connections. GIFs are returned untouched so
 * animations survive, and so is anything that would not get smaller.
 */
export async function shrinkImage(file: File, maxEdge = 1600): Promise<{ blob: Blob; type: string; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const { width: w0, height: h0 } = bmp;
  if (file.type === 'image/gif') {
    bmp.close();
    return { blob: file, type: file.type, width: w0, height: h0 };
  }
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const width = Math.round(w0 * scale);
  const height = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const encode = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.84));
  let out = await encode('image/webp');
  if (out?.type !== 'image/webp') out = await encode('image/jpeg');
  if (!out || (out.size >= file.size && scale === 1)) return { blob: file, type: file.type, width: w0, height: h0 };
  return { blob: out, type: out.type, width, height };
}
