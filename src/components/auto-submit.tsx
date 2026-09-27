'use client';
import { useEffect, useRef } from 'react';

/**
 * Progressive enhancement for GET filter forms: with JS, changing a control
 * submits the form. Without JS the "Apply filters" button still works.
 * Repeated checkbox names are folded into one comma-separated param.
 */
export function AutoSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const submit = () => {
      const data = new FormData(form);
      const qs = new URLSearchParams();
      for (const key of new Set(data.keys())) {
        const values = data.getAll(key).map(String).filter(Boolean);
        if (values.length) qs.set(key, values.join(','));
      }
      const action = form.getAttribute('action') ?? location.pathname;
      window.location.assign(qs.size ? `${action}?${qs}` : action);
    };
    form.addEventListener('change', submit);
    return () => form.removeEventListener('change', submit);
  }, []);
  return <span ref={ref} hidden />;
}
