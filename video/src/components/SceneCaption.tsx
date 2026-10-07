import { interpolate, useCurrentFrame } from 'remotion';
import { C, FONT } from '../theme';
import { EASE, progress } from '../lib/motion';

/**
 * The line above the app window that says what we're looking at. Words rise out
 * of a mask one after another; the whole caption lifts and blurs away on exit.
 */
export const SceneCaption: React.FC<{ eyebrow: string; headline: string; enter: number; exit: number }> = ({ eyebrow, headline, enter, exit }) => {
  const frame = useCurrentFrame();
  if (frame < enter - 1 || frame > exit + 20) return null;
  const out = progress(frame, exit, exit + 18, EASE.in);
  const words = headline.split(' ');
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, top: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
      opacity: 1 - out, transform: `translateY(${-out * 30}px)`, filter: `blur(${out * 8}px)`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, fontFamily: FONT.mono, fontSize: 17, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: C.accent, opacity: progress(frame, enter, enter + 16), transform: `translateY(${(1 - progress(frame, enter, enter + 20)) * 12}px)`,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: C.accent, boxShadow: `0 0 12px ${C.accent}` }} />
        {eyebrow}
      </div>
      <div style={{ display: 'flex', gap: '0.26em', fontFamily: FONT.sans, fontSize: 50, fontWeight: 600, letterSpacing: '-0.03em', color: C.ink, lineHeight: 1.1 }}>
        {words.map((w, i) => {
          const t = progress(frame, enter + 4 + i * 3, enter + 26 + i * 3);
          return (
            <span key={i} style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: 6 }}>
              <span style={{
                display: 'inline-block', transform: `translateY(${(1 - t) * 105}%) rotate(${(1 - t) * 4}deg)`,
                opacity: interpolate(t, [0, 0.3, 1], [0, 1, 1]),
              }}>{w}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};
