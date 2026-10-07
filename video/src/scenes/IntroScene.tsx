import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C, COPY, FONT } from '../theme';
import { CUE } from '../lib/cues';
import { EASE, progress } from '../lib/motion';

/** One word rising out of a mask, with a slight rotation that straightens as it lands. */
const RiseWord: React.FC<{ text: string; at: number; style?: React.CSSProperties }> = ({ text, at, style }) => {
  const frame = useCurrentFrame();
  const t = progress(frame, at, at + 24);
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', padding: '0 0.04em 0.12em', margin: '0 -0.04em' }}>
      <span style={{
        display: 'inline-block', transform: `translateY(${(1 - t) * 110}%) rotate(${(1 - t) * 6}deg)`,
        transformOrigin: 'left bottom', opacity: interpolate(t, [0, 0.25, 1], [0, 1, 1]), ...style,
      }}>{text}</span>
    </span>
  );
};

/**
 * Scene 1 (0–5 s): the problem, in kinetic type. "Every project starts from a
 * blank canvas." The accent phrase gets a lime highlight that wipes in behind
 * it, then the answer appears and the whole block lifts away as the app
 * window floats up underneath (the window itself lives in YowklyDemo).
 */
export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame > CUE.windowSettled) return null;

  const exit = progress(frame, CUE.introExit, CUE.introExit + 24, EASE.in);
  const wipe = progress(frame, CUE.highlight, CUE.highlight + 20, EASE.inOut);
  const answer = progress(frame, CUE.answer, CUE.answer + 22);
  // A slow push-in over the whole hook keeps the type alive while it holds.
  const push = interpolate(frame, [0, CUE.introExit], [0.96, 1], { easing: EASE.out, extrapolateRight: 'clamp' });

  const line: React.CSSProperties = {
    display: 'flex', justifyContent: 'center', gap: '0.24em', fontFamily: FONT.sans, fontWeight: 700,
    fontSize: 128, lineHeight: 1, letterSpacing: '-0.045em', color: C.ink,
  };

  return (
    <AbsoluteFill style={{
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 18,
      opacity: 1 - exit, filter: `blur(${exit * 14}px)`,
      transform: `translateY(${-exit * 120}px) scale(${push - exit * 0.04})`,
    }}>
      <div style={line}>
        {COPY.hookLine1.map((w, i) => <RiseWord key={w} text={w} at={CUE.line1 + i * 5} />)}
      </div>
      <div style={line}>
        {COPY.hookLine2.map((w, i) => <RiseWord key={w} text={w} at={CUE.line2 + i * 5} />)}
        <span style={{ position: 'relative', display: 'inline-block' }}>
          {/* the highlight bar wipes in left → right behind the words */}
          <span style={{
            position: 'absolute', left: '-0.08em', right: '-0.08em', top: '0.12em', bottom: '0.02em', borderRadius: 14,
            backgroundColor: C.accent, transform: `scaleX(${wipe})`, transformOrigin: 'left center',
            boxShadow: `0 0 ${60 * wipe}px rgba(212,255,58,${0.35 * wipe})`,
          }} />
          <span style={{ position: 'relative', display: 'inline-flex', gap: '0.22em' }}>
            {COPY.hookAccent.split(' ').map((w, i) => (
              <RiseWord key={w} text={w} at={CUE.line2 + 12 + i * 5}
                        style={{ fontFamily: FONT.serif, fontStyle: 'italic', fontWeight: 400, letterSpacing: '-0.02em', fontSize: 140, color: wipe > 0.5 ? C.onAccent : C.accent }} />
            ))}
          </span>
        </span>
      </div>
      <div style={{
        marginTop: 26, fontFamily: FONT.mono, fontSize: 26, letterSpacing: '0.04em', color: C.ink2,
        opacity: answer, transform: `translateY(${(1 - answer) * 18}px)`, display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <span style={{ width: 40 * answer, height: 2, backgroundColor: C.accent }} />
        {COPY.hookAnswer}
        <span style={{ width: 40 * answer, height: 2, backgroundColor: C.accent }} />
      </div>
    </AbsoluteFill>
  );
};
