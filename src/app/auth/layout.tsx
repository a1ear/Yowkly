import { Cover } from '@/components/cover';
import { Icon, type IconName } from '@/components/icons';

const PERKS: [IconName, string, string][] = [
  ['bit', '100 yowkbits to start', 'Spend them voting for the work you rate. One vote per template.'],
  ['download', 'Free downloads', 'Every file is virus-scanned, with its license shown before you download it.'],
  ['trophy', 'Get ranked', 'Publish your work and climb to Template of the Day or Dev of the Week.'],
];

/** Split screen: the pitch on the left (desktop only), the form card on the right. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 py-10 md:px-10 lg:min-h-[calc(100dvh-72px)] lg:grid-cols-[1.1fr_minmax(0,460px)] lg:py-14">
      <aside className="hero-glow relative hidden flex-col gap-8 lg:flex" aria-label="Why join Yowkly">
        <div className="flex flex-col gap-4">
          <span className="rise eyebrow">Yowkly · by NightPatch</span>
          <p className="m-0 font-display text-[88px] leading-[0.9] tracking-[-0.03em]">
            <span className="word-rise inline-block" style={{ animationDelay: '60ms' }}>For</span>{' '}
            <span className="word-rise inline-block" style={{ animationDelay: '140ms' }}>Devs</span>
            <br />
            <span className="word-rise inline-block italic text-accent-ink" style={{ animationDelay: '220ms' }}>by</span>{' '}
            <span className="word-rise inline-block" style={{ animationDelay: '300ms' }}>Devs.</span>
          </p>
        </div>
        <ul className="m-0 flex max-w-md list-none flex-col gap-4 p-0">
          {PERKS.map(([icon, title, body], i) => (
            <li key={title} className="rise flex gap-3.5" style={{ animationDelay: `${380 + i * 80}ms` }}>
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent-ink shadow-[inset_0_0_0_1px_var(--line)]">
                <Icon name={icon} size={19} strokeWidth={2} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{title}</span>
                <span className="text-[13.5px] text-ink-2">{body}</span>
              </span>
            </li>
          ))}
        </ul>
        {/* Decorative: three generated covers drifting behind the pitch. */}
        <div aria-hidden="true" className="pointer-events-none absolute top-0 right-0 -z-10 hidden h-[230px] w-[300px] opacity-55 xl:block">
          {['nocturne', 'lumen', 'field'].map((seed, i) => (
            <div key={seed} className="float-card absolute w-[190px] overflow-hidden rounded-xl shadow-e3 ring-1 ring-line"
                 style={{ right: i * 56, bottom: i * 44, rotate: `${(i - 1) * 7}deg`, animationDelay: `${i * -2}s` }}>
              <div className="aspect-[16/10]"><Cover seed={seed} title="" kind={i === 1 ? 'mobile' : 'web'} /></div>
            </div>
          ))}
        </div>
      </aside>
      <div className="rise mx-auto w-full max-w-[460px] rounded-2xl bg-surface-1 p-6 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-e2)] md:p-9" style={{ animationDelay: '120ms' }}>
        {children}
      </div>
    </div>
  );
}
