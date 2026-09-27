'use client';
import { useRef, useState } from 'react';

/** WAI-ARIA tabs: arrow keys move between tabs, panels are server-rendered children. */
export function DetailTabs({ tabs }: { tabs: { id: string; label: string; count?: number; panel: React.ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0].id);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = tabs[(i + d + tabs.length) % tabs.length].id;
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Template details" className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className="-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-ink-2 hover:text-ink aria-selected:border-accent aria-selected:text-ink"
          >
            {t.label}
            {t.count != null && <span className="font-mono text-xs text-ink-3">{t.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={active !== t.id}>
          {t.panel}
        </div>
      ))}
    </div>
  );
}
