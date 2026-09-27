'use client';
import { useEffect, useRef } from 'react';
import { Icon } from './icons';

/** Native <dialog>: focus trap, Escape and inert background come from the browser. */
export function Dialog({ open, onClose, title, children, width = 440 }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="dialog-title"
      className="m-auto w-[calc(100%-32px)] rounded-2xl bg-surface-1 p-0 text-ink shadow-e3 ring-1 ring-line backdrop:bg-black/60"
      style={{ maxWidth: width }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 id="dialog-title" className="m-0 text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
