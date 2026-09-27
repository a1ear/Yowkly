import Link from 'next/link';
import { Icon } from '../icons';

export const STEPS = ['Basics', 'Source', 'Media', 'License & version', 'Review & publish'] as const;

export function Stepper({ step, templateId, done }: { step: number; templateId: string | null; done: boolean[] }) {
  return (
    <>
      <nav aria-label="Upload steps" className="hidden md:block">
        <ol className="m-0 flex list-none items-center gap-2 p-0">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const current = n === step;
            const reachable = templateId !== null || n === 1;
            const content = (
              <>
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] ${
                  current ? 'bg-accent text-on-accent' : done[i] ? 'bg-surface-3 text-success' : 'bg-surface-2 text-ink-3'}`}>
                  {done[i] && !current ? <Icon name="check" size={13} strokeWidth={2.5} /> : n}
                </span>
                <span className={current ? 'text-ink' : 'text-ink-2'}>{label}</span>
              </>
            );
            return (
              <li key={label} className="flex items-center gap-2">
                {i > 0 && <span className="h-px w-6 bg-line" aria-hidden="true" />}
                {reachable ? (
                  <Link href={templateId ? `/upload/${templateId}?step=${n}` : '/upload'} aria-current={current ? 'step' : undefined}
                        className="inline-flex h-11 items-center gap-2 text-[13px] font-medium">{content}</Link>
                ) : <span className="inline-flex h-11 items-center gap-2 text-[13px] font-medium opacity-60">{content}</span>}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="md:hidden">
        <p className="m-0 text-[13px] font-semibold">Step {step} of {STEPS.length}</p>
        <div role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={STEPS.length} aria-label={`Step ${step} of ${STEPS.length}`}
             className="mt-2 h-[3px] rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${(step / STEPS.length) * 100}%` }} />
        </div>
      </div>
    </>
  );
}
