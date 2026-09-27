'use client';
import { useState } from 'react';
import { Icon, type IconName } from '../icons';

const DEVICES: [string, string, IconName, number][] = [
  ['desktop', 'Desktop', 'monitor', 100],
  ['tablet', 'Tablet', 'tablet', 768],
  ['mobile', 'Mobile', 'phone', 390],
];

/**
 * Demo URLs are always another origin (validated https, never our own host), so
 * the sandbox can allow scripts + same-origin for that site without giving it
 * any access to Yowkly. No top navigation, no downloads, no referrer.
 */
export function LivePreview({ url }: { url: string | null }) {
  const [device, setDevice] = useState('desktop');
  const [loaded, setLoaded] = useState(false);
  const width = DEVICES.find((d) => d[0] === device)![3];
  let host = '';
  try { host = url ? new URL(url).host : ''; } catch { host = ''; }

  return (
    <section aria-labelledby="preview-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="preview-title" className="m-0 font-display text-[28px] font-normal">Live preview</h2>
        {url && (
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Preview device" className="flex rounded-md bg-surface-1 p-1 shadow-[inset_0_0_0_1px_var(--line)]">
              {DEVICES.map(([id, label, icon]) => (
                <button key={id} type="button" aria-pressed={device === id} onClick={() => setDevice(id)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-[13px] text-ink-2 aria-pressed:bg-surface-3 aria-pressed:text-ink">
                  <Icon name={icon} size={15} /><span className="max-sm:sr-only">{label}</span>
                </button>
              ))}
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer nofollow ugc" className="btn btn-ghost h-10 px-3 text-[13px]">
              <Icon name="external" size={15} />Open demo
            </a>
          </div>
        )}
      </div>
      {url ? (
        <div className="overflow-hidden rounded-xl bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="flex h-9 items-center gap-2 border-b border-line px-3">
            <span className="flex gap-1.5" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="h-2.5 w-2.5 rounded-full bg-surface-3" />)}</span>
            <span className="mx-auto max-w-[60%] truncate rounded-sm bg-surface-1 px-3 py-0.5 font-mono text-[11px] text-ink-3">{host}</span>
          </div>
          <div className="relative flex h-[560px] justify-center bg-canvas">
            {!loaded && <div className="skeleton absolute inset-4" aria-label="Loading preview" />}
            <iframe
              src={url}
              title={`Live demo of ${host}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={() => setLoaded(true)}
              className="h-full border-0 bg-white transition-[width] duration-300"
              style={{ width: width === 100 ? '100%' : width, maxWidth: '100%' }}
            />
          </div>
        </div>
      ) : (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-center text-ink-2">
          <Icon name="monitor" size={22} className="text-ink-3" />
          <p className="m-0">No live demo for this one. Browse the screens above or download the files.</p>
        </div>
      )}
    </section>
  );
}
