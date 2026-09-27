/** Two-series line chart as static SVG (no chart library for one chart). */
export function LineChart({ days, series }: {
  days: string[];
  series: { name: string; values: number[]; color: string }[];
}) {
  const W = 800, H = 220, P = { t: 12, r: 12, b: 28, l: 40 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => P.l + (i / Math.max(1, days.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.ceil(days.length / 6);
  const summary = series.map((s) => `${s.name}: ${s.values.reduce((a, b) => a + b, 0)} total`).join('; ');
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Daily ${series.map((s) => s.name).join(' and ')} over ${days.length} days. ${summary}.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={P.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)" fontFamily="var(--font-mono)">{t}</text>
          </g>
        ))}
        {days.map((d, i) => i % labelEvery === 0 && (
          <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)" fontFamily="var(--font-mono)">
            {new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
          </text>
        ))}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"
                    points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
      </svg>
      <figcaption className="mt-2 flex gap-4 text-[12px] text-ink-2">
        {series.map((s) => <span key={s.name} className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-full" style={{ background: s.color }} />{s.name}</span>)}
      </figcaption>
    </figure>
  );
}
