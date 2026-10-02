'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

/**
 * Collapsible header search. Closed it is a single icon button; open it slides
 * out into a field (on phones it takes over the header row). ⌘K / Ctrl+K opens
 * it, Escape or clicking away with an empty field closes it. Submitting is a
 * plain GET to /explore, so it works before JavaScript loads too.
 */
export function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!formRef.current?.contains(e.target as Node) && !inputRef.current?.value) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <form
      ref={formRef}
      action="/explore"
      role="search"
      data-open={open || undefined}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      className="flex items-center gap-1 md:relative data-open:max-md:absolute data-open:max-md:inset-0 data-open:max-md:z-10 data-open:max-md:bg-canvas data-open:max-md:px-4"
    >
      <label
        className={`search-field flex h-10 items-center gap-2.5 overflow-hidden rounded-md bg-surface-1 text-ink-3 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_2px_var(--accent)] md:absolute md:top-1/2 md:right-11 md:z-20 md:-translate-y-1/2 md:shadow-[inset_0_0_0_1px_var(--line),var(--shadow-e2)] ${
          open ? 'min-w-0 flex-1 px-3.5 opacity-100 md:w-[360px] md:flex-none lg:w-[440px]' : 'pointer-events-none w-0 px-0 opacity-0'}`}
      >
        <Icon name="search" size={17} className="shrink-0" />
        <span className="sr-only">Search templates</span>
        <input
          ref={inputRef}
          id="site-search"
          type="search"
          name="q"
          placeholder="Search templates, creators, stacks"
          autoComplete="off"
          tabIndex={open ? 0 : -1}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
        <kbd className="hidden rounded-[5px] px-1.5 py-[3px] font-mono text-[11px] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)] lg:inline">Esc</kbd>
      </label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="site-search"
        aria-label={open ? 'Close search' : 'Open search (Ctrl+K)'}
        title={open ? 'Close search' : 'Search (Ctrl+K)'}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink hover:bg-surface-2"
      >
        <Icon name={open ? 'x' : 'search'} size={20} className="icon-swap" key={String(open)} />
      </button>
    </form>
  );
}
