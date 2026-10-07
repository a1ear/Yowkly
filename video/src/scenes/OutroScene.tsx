import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C, COPY, FONT } from '../theme';
import { CUE } from '../lib/cues';
import { EASE, SPRING, progress, springAt } from '../lib/motion';
import { CtaButton } from '../components/CtaButton';
import { Logo } from '../components/Icons';

/** Where the CTA button's centre sits (the cursor's last target). */
export const CTA_CENTER = { x: 960, y: 620 } as const;

/**
 * Scene 4 (25–30 s): with the app receding behind it (handled in YowklyDemo),
 * the mark draws itself (outline traces, lime square drops in with a bounce),
 * the wordmark rises letter by letter, then the CTA springs up and breathes.
 */
export const OutroScene: React.FC<{ hover: number }> = ({ hover }) => {
  const frame = useCurrentFrame();
  if (frame < CUE.logoDrawFrom - 2) return null;

  const draw = progress(frame, CUE.logoDrawFrom, CUE.logoDrawTo, EASE.inOut);
  const drop = springAt(frame, CUE.logoDrop, SPRING.bouncy);
  const tagline = progress(frame, CUE.tagline, CUE.tagline + 22);
  const cta = springAt(frame, CUE.cta, SPRING.snappy);
  // A slow breath on the CTA once it has landed: 0 → 1 → 0 every 1.2 s.
  const pulse = frame < CUE.pulseFrom ? 0 : (1 - Math.cos(((frame - CUE.pulseFrom) / 36) * Math.PI * 2)) / 2;
  const url = progress(frame, CUE.cta + 14, CUE.cta + 34);
  // The lockup eases upward a touch as each element arrives, so the stack stays centred.
  const lift = interpolate(frame, [CUE.logoDrop, CUE.cta + 20], [40, 0], { easing: EASE.out, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const word = 'Yowkly';
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${lift - 40}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <div style={{ filter: `drop-shadow(0 0 ${28 * Math.min(1, Math.max(0, drop))}px rgba(212,255,58,0.45))` }}>
            <Logo size={128} draw={draw} drop={drop} />
          </div>
          <div style={{ display: 'flex', fontFamily: FONT.serif, fontSize: 168, lineHeight: 1, letterSpacing: '-0.02em', color: C.ink }}>
            {word.split('').map((ch, i) => {
              const t = springAt(frame, CUE.wordmark + i * 3, SPRING.soft);
              return (
                <span key={i} style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: 18, marginBottom: -18 }}>
                  <span style={{
                    display: 'inline-block', transform: `translateY(${(1 - t) * 60}%)`,
                    opacity: Math.min(1, Math.max(0, t * 1.6 - 0.2)), filter: `blur(${Math.max(0, 1 - t) * 8}px)`,
                  }}>{ch}</span>
                </span>
              );
            })}
          </div>
        </div>

        <div style={{
          marginTop: 22, display: 'flex', gap: '0.28em', fontFamily: FONT.sans, fontSize: 36, fontWeight: 500, letterSpacing: '-0.02em', color: C.ink2,
          opacity: tagline, transform: `translateY(${(1 - tagline) * 16}px)`, filter: `blur(${(1 - tagline) * 6}px)`,
        }}>
          {COPY.tagline.split(' ').map((w, i) => (
            <span key={i} style={w === 'by' ? { fontFamily: FONT.serif, fontStyle: 'italic', fontSize: 40, color: C.accent } : undefined}>{w}</span>
          ))}
        </div>

        <div style={{ marginTop: 60, opacity: Math.min(1, Math.max(0, cta * 1.4)), transform: `translateY(${(1 - cta) * 40}px) scale(${0.85 + 0.15 * cta})` }}>
          <CtaButton label={COPY.cta} pulse={pulse} hover={hover} />
        </div>

        <div style={{
          marginTop: 30, fontFamily: FONT.mono, fontSize: 20, letterSpacing: '0.06em', color: C.ink3,
          opacity: url, transform: `translateY(${(1 - url) * 10}px)`,
        }}>{COPY.url}</div>
      </div>
    </AbsoluteFill>
  );
};
