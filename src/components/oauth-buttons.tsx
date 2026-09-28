import { oauth } from '@/app/actions/auth';
import { Icon } from './icons';

export function OAuthButtons({ next }: { next: string }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <form action={oauth}>
        <input type="hidden" name="provider" value="github" />
        <input type="hidden" name="next" value={next} />
        <button className="btn btn-secondary btn-lg w-full" aria-label="Continue with GitHub"><Icon name="github" size={18} />GitHub</button>
      </form>
      <form action={oauth}>
        <input type="hidden" name="provider" value="google" />
        <input type="hidden" name="next" value={next} />
        <button className="btn btn-secondary btn-lg w-full" aria-label="Continue with Google">
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.35 11.1H12v2.9h5.35c-.23 1.5-1.7 4.4-5.35 4.4-3.22 0-5.85-2.67-5.85-5.95S8.78 6.5 12 6.5c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.69 3.95 14.55 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.59-.06-1.04-.14-1.5z" /></svg>
          Google
        </button>
      </form>
      <div className="my-1 flex items-center gap-3 font-mono text-[11px] tracking-[.08em] text-ink-3 uppercase sm:col-span-2" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
