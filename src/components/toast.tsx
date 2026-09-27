'use client';
import { createContext, useCallback, useContext, useState } from 'react';
import { Icon } from './icons';

type Toast = { id: number; text: string; tone: 'ok' | 'error'; action?: { label: string; run: () => void } };
const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} role="status"
               className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-surface-3 px-4 py-3 text-sm text-ink shadow-e2 ring-1 ring-line">
            <span className={t.tone === 'error' ? 'text-danger' : 'text-success'}>
              <Icon name={t.tone === 'error' ? 'alert' : 'check'} size={17} strokeWidth={2.2} />
            </span>
            <span>{t.text}</span>
            {t.action && (
              <button type="button" onClick={t.action.run} className="ml-1 font-semibold text-accent-ink underline-offset-4 hover:underline">
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
