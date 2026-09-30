'use client';
import { useCallback, useRef, useState } from 'react';
import { Dialog } from './dialog';
import { Icon } from './icons';

export type CropShape = { label: string; aspect: number | null };

/**
 * Crop an image before it is uploaded: drag to position, slider (or wheel) to
 * zoom, arrow keys to nudge. The crop happens in the browser on a canvas, so
 * the original never leaves the device. An `aspect` of null means "keep the
 * whole image". Returns a PNG file of the cropped area (the upload code then
 * resizes and re-encodes it).
 */
export function ImageCropper({ file, shapes, round, title = 'Crop image', onDone, onCancel }: {
  file: File;
  shapes: CropShape[];
  round?: boolean;
  title?: string;
  onDone: (cropped: File) => void;
  onCancel: () => void;
}) {
  const [src] = useState(() => URL.createObjectURL(file));
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [shape, setShape] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // image offset from the frame's top-left, in frame pixels
  const [width, setWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Released when the cropper finishes or is cancelled (not in an effect cleanup, which
  // React runs between its two development mounts and would break the preview).
  const finish = (f: File | null) => { URL.revokeObjectURL(src); if (f) onDone(f); else onCancel(); };
  // Measure as soon as the crop area mounts, then follow resizes.
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = shapes[shape].aspect ?? (natural ? natural.w / natural.h : 1);
  // Tall shapes (phone screens) are limited by height, not width.
  // The dialog is still hidden when this mounts, so assume a typical width until it is measured.
  const box = Math.max(240, width || Math.min(560, typeof window === 'undefined' ? 560 : window.innerWidth - 80));
  const frameW = Math.min(box, 420 * aspect);
  const frameH = frameW / aspect;
  const base = natural ? Math.max(frameW / natural.w, frameH / natural.h) : 1;
  const scale = base * zoom;
  const imgW = (natural?.w ?? 0) * scale;
  const imgH = (natural?.h ?? 0) * scale;

  const clamp = (p: { x: number; y: number }) => ({
    x: Math.min(0, Math.max(frameW - imgW, p.x)),
    y: Math.min(0, Math.max(frameH - imgH, p.y)),
  });
  // Keep the image covering the frame whenever the frame, shape or zoom changes.
  const view = clamp(pos);

  const setZoomAround = (next: number) => {
    const z = Math.min(4, Math.max(1, next));
    // Zoom around the frame's centre so the subject stays put.
    const cx = frameW / 2 - view.x;
    const cy = frameH / 2 - view.y;
    const k = z / zoom;
    setPos({ x: frameW / 2 - cx * k, y: frameH / 2 - cy * k });
    setZoom(z);
  };

  const done = async () => {
    if (!natural) return;
    setBusy(true);
    try {
      const sx = -view.x / scale, sy = -view.y / scale, sw = frameW / scale, sh = frameH / scale;
      // Draw from the image already on screen (it has loaded, so there's nothing to wait for).
      const img = imgRef.current;
      if (!img) throw new Error('no image');
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));
      canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('crop failed');
      finish(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' }));
    } catch {
      finish(file); // fall back to the original rather than losing the upload
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => finish(null)} title={title} width={640}>
      <div className="flex flex-col gap-4">
        {shapes.length > 1 && (
          <div role="group" aria-label="Shape" className="flex flex-wrap gap-1.5">
            {shapes.map((s, i) => (
              <button key={s.label} type="button" aria-pressed={shape === i} onClick={() => { setShape(i); setZoom(1); setPos({ x: 0, y: 0 }); }}
                      className="filter-chip aria-pressed:bg-accent aria-pressed:text-on-accent">{s.label}</button>
            ))}
          </div>
        )}
        <div ref={measure} className="flex w-full justify-center rounded-lg bg-canvas">
          <div
            role="application"
            aria-label="Crop area. Drag or use the arrow keys to move the image, plus and minus to zoom."
            tabIndex={0}
            className={`relative touch-none overflow-hidden outline-offset-2 select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'} ${round ? 'rounded-full' : 'rounded-md'}`}
            style={{ width: frameW, height: frameH }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: view.x, py: view.y }; setDragging(true); }}
            onPointerMove={(e) => { const d = drag.current; if (d) setPos({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }); }}
            onPointerUp={() => { drag.current = null; setDragging(false); }}
            onPointerCancel={() => { drag.current = null; setDragging(false); }}
            onWheel={(e) => setZoomAround(zoom - e.deltaY * 0.0015)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 40 : 10;
              const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
              if (moves[e.key]) { e.preventDefault(); setPos({ x: view.x + moves[e.key][0], y: view.y + moves[e.key][1] }); }
              if (e.key === '+' || e.key === '=') setZoomAround(zoom + 0.1);
              if (e.key === '-') setZoomAround(zoom - 0.1);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={src} alt="" draggable={false} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                 className="pointer-events-none absolute top-0 left-0 max-w-none"
                 style={{ width: imgW || undefined, height: imgH || undefined, transform: `translate(${view.x}px, ${view.y}px)` }} />
            <div aria-hidden="true" className={`pointer-events-none absolute inset-0 shadow-[inset_0_0_0_2px_rgba(255,255,255,.85)] ${round ? 'rounded-full' : 'rounded-md'}`} />
          </div>
        </div>
        <label className="flex items-center gap-3 text-[13px] text-ink-2">
          <Icon name="search" size={15} />
          <span className="sr-only">Zoom</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoomAround(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
        </label>
        <p className="m-0 text-[12px] text-ink-3">Drag to reposition. Scroll or use the slider to zoom.</p>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={() => finish(null)} className="btn btn-ghost">Cancel</button>
          <button type="button" onClick={done} disabled={!natural || busy} className="btn btn-primary">{busy ? 'Cropping…' : 'Apply crop'}</button>
        </div>
      </div>
    </Dialog>
  );
}
