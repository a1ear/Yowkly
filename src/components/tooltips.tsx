'use client';
import { useEffect, useRef, useState } from 'react';

type Tip = { text: string; x: number; y: number; below: boolean };

/**
 * One tooltip system for the whole site. Any button or link that has a label but
 * no visible text (icon buttons), or anything with `data-tip` or `title`, shows a
 * small styled tooltip on hover or keyboard focus. Native `title` tooltips are
 * converted so the two never appear together. Touch taps don't trigger it.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    const labelOf = (el: Element) => {
      const t = el.getAttribute('title');
      if (t) {
        // Move the native title into data-tip (keeping the accessible name if it was the only one).
        if (!el.getAttribute('aria-label') && !(el.textContent ?? '').trim()) el.setAttribute('aria-label', t);
        el.setAttribute('data-tip', t);
        el.removeAttribute('title');
      }
      const explicit = el.getAttribute('data-tip');
      if (explicit) return explicit;
      const aria = el.getAttribute('aria-label');
      const iconOnly = !(el.textContent ?? '').trim();
      return aria && iconOnly ? aria : null;
    };
    const find = (target: EventTarget | null) =>
      target instanceof Element ? target.closest('[data-tip], [title], button[aria-label], a[aria-label], [role="button"][aria-label]') : null;

    const show = (el: Element) => {
      const text = labelOf(el);
      if (!text) return;
      current.current = el;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 44;
        setTip({ text, x: Math.min(Math.max(r.left + r.width / 2, 12), window.innerWidth - 12), y: below ? r.bottom + 8 : r.top - 8, below });
      }, 350);
    };
    const hide = () => { clearTimeout(timer.current); current.current = null; setTip(null); };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = find(e.target);
      if (el && el !== current.current) show(el);
      else if (!el && current.current) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = find(e.target);
      if (el && (e.target as Element).matches?.(':focus-visible')) show(el);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, { capture: true });
    };
  }, []);

  if (!tip) return null;
  // Decorative: the element already has the same text as its accessible name.
  return (
    <div aria-hidden="true" className="tooltip-in pointer-events-none fixed z-[100] max-w-[240px] rounded-md bg-ink px-2 py-1 text-center text-[12px] leading-snug font-medium text-canvas shadow-e2"
         style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` }}>
      {tip.text}
    </div>
  );
}
