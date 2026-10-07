import { interpolate, useCurrentFrame } from 'remotion';
import { C, COPY, FONT, METRICS } from '../theme';
import { CUE, morphAt } from '../lib/cues';
import { EASE, SPRING, countUp, formatNumber, progress, springAt } from '../lib/motion';
import { CARD_COUNT, CHART_PANEL, METRIC_PANEL, PLOT, barRect } from '../lib/layout';
import { Icon } from '../components/Icons';

const GRIDLINES = 4;

/**
 * Scene 3 (15–25 s), behind the bars: the metric panel and the chart frame
 * (title, gridlines that draw in left to right, week labels).
 */
export const ValueBackdrop: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < CUE.morph) return null;
  const chart = springAt(frame, CUE.chartIn, SPRING.soft);
  const panel = springAt(frame, CUE.panelIn, SPRING.soft);
  const lines = progress(frame, CUE.chartIn + 6, CUE.chartIn + 40, EASE.inOut);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* metric panel */}
      <div style={{
        position: 'absolute', left: METRIC_PANEL.x, top: METRIC_PANEL.y, width: METRIC_PANEL.w, height: METRIC_PANEL.h,
        borderRadius: 20, backgroundColor: C.surface1, boxShadow: `inset 0 0 0 1px ${C.line}`,
        opacity: Math.min(1, panel * 1.3), transform: `translateX(${(1 - panel) * -60}px) scale(${0.96 + 0.04 * panel})`,
      }} />
      {/* chart panel */}
      <div style={{
        position: 'absolute', left: CHART_PANEL.x, top: CHART_PANEL.y, width: CHART_PANEL.w, height: CHART_PANEL.h,
        borderRadius: 20, backgroundColor: C.surface1, boxShadow: `inset 0 0 0 1px ${C.line}`,
        opacity: Math.min(1, chart * 1.3), transform: `translateY(${(1 - chart) * 30}px)`,
      }}>
        <div style={{ position: 'absolute', left: 36, top: 30, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 12.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3 }}>Last 8 weeks</span>
          <span style={{ fontFamily: FONT.sans, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: C.ink }}>{COPY.chartTitle}</span>
        </div>
        <div style={{ position: 'absolute', right: 32, top: 36, display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT.sans, fontSize: 13.5, color: C.ink2 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: `linear-gradient(180deg, ${C.accentSoft}, ${C.accent})` }} />Hours saved
        </div>
      </div>
      {/* gridlines + y labels (canvas coordinates, aligned with the bars) */}
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible', opacity: Math.min(1, chart * 1.3) }}>
        {Array.from({ length: GRIDLINES + 1 }, (_, g) => {
          const y = PLOT.baseline - (g / GRIDLINES) * (PLOT.baseline - PLOT.top);
          const len = (PLOT.right - PLOT.left + 12) * lines;
          return (
            <g key={g}>
              <line x1={PLOT.left - 6} x2={PLOT.left - 6 + len} y1={y} y2={y} stroke={g === 0 ? '#4A463D' : C.line} strokeWidth={1} strokeDasharray={g === 0 ? undefined : '3 6'} />
              <text x={PLOT.left - 14} y={y + 4} textAnchor="end" fontFamily={FONT.mono} fontSize="11.5" fill={C.ink3} opacity={lines}>{g * 25}h</text>
            </g>
          );
        })}
      </svg>
      {/* week labels */}
      {Array.from({ length: CARD_COUNT }, (_, i) => {
        const b = barRect(i);
        const t = progress(frame, morphAt(i) + 18, morphAt(i) + 34);
        return (
          <div key={i} style={{
            position: 'absolute', left: b.x - 10, width: b.w + 20, top: PLOT.baseline + 14, textAlign: 'center',
            fontFamily: FONT.mono, fontSize: 12.5, color: C.ink3, opacity: t, transform: `translateY(${(1 - t) * 8}px)`,
          }}>{METRICS.weekLabels[i]}</div>
        );
      })}
    </div>
  );
};

/**
 * Scene 3, in front of the bars: value labels, the trend line drawing through
 * the bar tops, and the "Hours saved" counter ticking up in the metric panel.
 */
export const ValueOverlay: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < CUE.morph) return null;
  const panel = springAt(frame, CUE.panelIn, SPRING.soft);
  const count = countUp(frame, CUE.counterFrom, CUE.counterTo, METRICS.hoursSaved);
  const done = springAt(frame, CUE.counterTo, SPRING.snappy);
  const donePulse = interpolate(frame, [CUE.counterTo, CUE.counterTo + 10, CUE.counterTo + 40], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const trend = progress(frame, CUE.trendFrom, CUE.trendTo, EASE.inOut);
  const meter = progress(frame, CUE.counterFrom, CUE.counterTo, EASE.out);

  // Trend line through the bar tops, as a smooth path.
  const pts = Array.from({ length: CARD_COUNT }, (_, i) => { const b = barRect(i); return { x: b.x + b.w / 2, y: b.y - 18 }; });
  const d = pts.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
  }, '');

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* metric panel content */}
      <div style={{
        position: 'absolute', left: METRIC_PANEL.x + 34, top: METRIC_PANEL.y + 34, width: METRIC_PANEL.w - 68, height: METRIC_PANEL.h - 68,
        display: 'flex', flexDirection: 'column', opacity: Math.min(1, panel * 1.3), transform: `translateX(${(1 - panel) * -60}px)`,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(212,255,58,0.12)', boxShadow: 'inset 0 0 0 1px rgba(212,255,58,0.3)', color: C.accent,
        }}>
          <Icon name="clock" size={28} />
        </div>
        <span style={{ marginTop: 34, fontFamily: FONT.mono, fontSize: 14, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3 }}>{COPY.metricLabel}</span>
        <div style={{
          marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: FONT.sans, fontWeight: 700,
          letterSpacing: '-0.05em', color: C.ink, fontVariantNumeric: 'tabular-nums',
          transform: `scale(${1 + donePulse * 0.04})`, transformOrigin: 'left center',
          textShadow: `0 0 ${donePulse * 40}px rgba(212,255,58,${donePulse * 0.6})`,
        }}>
          <span style={{ fontSize: 96, lineHeight: 1 }}>{formatNumber(count)}</span>
          <span style={{ fontSize: 40, color: C.accent }}>h</span>
        </div>
        <p style={{ margin: '16px 0 0', fontFamily: FONT.sans, fontSize: 17, lineHeight: 1.45, color: C.ink2 }}>{COPY.metricCaption}</p>
        {/* progress meter */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT.mono, fontSize: 12.5, color: C.ink3 }}>
            <span>From scratch</span><span style={{ color: C.accent }}>With Yowkly</span>
          </div>
          <div style={{ position: 'relative', height: 12, borderRadius: 12, backgroundColor: C.surface3, overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: `${meter * 100}%`, borderRadius: 12,
              background: `linear-gradient(90deg, #A9D11C, ${C.accent}, ${C.accentSoft})`, boxShadow: `0 0 16px rgba(212,255,58,0.5)`,
            }} />
          </div>
          <div style={{
            alignSelf: 'flex-start', height: 30, padding: '0 12px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 6,
            backgroundColor: C.accent, color: C.onAccent, fontFamily: FONT.sans, fontSize: 13.5, fontWeight: 600,
            opacity: done, transform: `scale(${0.7 + 0.3 * done}) translateY(${(1 - done) * 8}px)`, transformOrigin: 'left center',
          }}>
            <Icon name="check" size={14} strokeWidth={2.4} />{COPY.metricBadge}
          </div>
        </div>
      </div>

      {/* bar value labels */}
      {Array.from({ length: CARD_COUNT }, (_, i) => {
        const b = barRect(i);
        const t = springAt(frame, CUE.barLabels + i * 4, SPRING.snappy);
        return (
          <div key={i} style={{
            position: 'absolute', left: b.x - 14, width: b.w + 28, top: b.y - 52, textAlign: 'center',
            fontFamily: FONT.mono, fontSize: 13, fontWeight: 500, color: C.ink,
            opacity: Math.min(1, Math.max(0, t)), transform: `translateY(${(1 - t) * 10}px) scale(${0.8 + 0.2 * t})`,
          }}>{METRICS.weeklyBars[i]}h</div>
        );
      })}

      {/* trend line */}
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <filter id="trendGlow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path d={d} fill="none" stroke={C.accentSoft} strokeWidth={3} strokeLinecap="round" filter="url(#trendGlow)"
              pathLength={1} strokeDasharray={1} strokeDashoffset={1 - trend} />
        {pts.map((p, i) => {
          const on = progress(frame, CUE.trendFrom + (i / (CARD_COUNT - 1)) * (CUE.trendTo - CUE.trendFrom) - 2, CUE.trendFrom + (i / (CARD_COUNT - 1)) * (CUE.trendTo - CUE.trendFrom) + 8, EASE.pop);
          return <circle key={i} cx={p.x} cy={p.y} r={5 * on} fill={C.canvas} stroke={C.accentSoft} strokeWidth={2.5} />;
        })}
      </svg>
    </div>
  );
};
