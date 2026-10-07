import { interpolate, useCurrentFrame } from 'remotion';
import { C, FONT } from '../theme';
import { CUE, cardInAt, morphAt } from '../lib/cues';
import { EASE, SPRING, mix, progress, springAt } from '../lib/motion';
import { CARD_COUNT, GRID, barRect, cardRect } from '../lib/layout';
import { TEMPLATES, TemplateCardContent } from './TemplateCard';

const VOTED_CARD = 1;
const HOVER_CARD_2 = 6;

/**
 * The eight template cards, through two scenes:
 *  · Scene 2: they spring into the grid one after another; the cursor hovers one
 *    and spends a yowkbit on it (the pill flips lime, +1 floats up).
 *  · Scene 3: each card morphs, left to right, into a bar of the "time saved"
 *    chart. Position, size, corner radius and colour are all interpolated from
 *    one spring per card, so it reads as the same object changing shape.
 */
export const CardField: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < CUE.cardsIn - 1) return null;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {Array.from({ length: CARD_COUNT }, (_, i) => {
        const appear = springAt(frame, cardInAt(i), SPRING.soft);
        if (appear <= 0.001) return null;
        const m = Math.max(0, springAt(frame, morphAt(i), { damping: 18, stiffness: 95, mass: 1 }));
        const from = cardRect(i);
        const to = barRect(i);
        const x = mix(from.x, to.x, m);
        const y = mix(from.y, to.y, m);
        const w = Math.max(8, mix(from.w, to.w, m));
        const h = Math.max(8, mix(from.h, to.h, m));
        const lime = interpolate(m, [0.25, 0.9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const content = interpolate(m, [0, 0.3], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

        // Hover: the card lifts toward the viewer while the cursor rests on it.
        const hoverIn = (start: number, end: number) => progress(frame, start - 12, start + 4) * (1 - progress(frame, end, end + 12, EASE.inOut));
        const hover = i === VOTED_CARD ? hoverIn(CUE.cursorAtCard, CUE.cursorAtVote + 30)
          : i === HOVER_CARD_2 ? hoverIn(CUE.cursorAtCard6, CUE.cursorOutStart) : 0;

        // Vote on card 1: press dip, then a bouncy release.
        const isVoted = i === VOTED_CARD;
        const clickT = frame - CUE.voteClick;
        const votePop = !isVoted || clickT < 0 ? 1
          : clickT < 4 ? mix(1, 0.86, clickT / 4)
          : 0.86 + 0.14 * springAt(frame, CUE.voteClick + 4, SPRING.bouncy);
        const voted = isVoted ? progress(frame, CUE.voteClick + 1, CUE.voteClick + 7) : 0;
        const votes = TEMPLATES[i].votes + (isVoted && clickT >= 2 ? 1 : 0);
        const float = isVoted ? progress(frame, CUE.voteClick + 2, CUE.voteClick + 34) : 0;

        return (
          <div key={i}>
            <div style={{
              position: 'absolute', left: x, top: y, width: w, height: h,
              borderRadius: mix(16, 10, m),
              overflow: 'hidden',
              backgroundColor: C.surface1,
              boxShadow: [
                `inset 0 0 0 1px rgba(46,43,37,${1 - lime})`,
                `inset 0 0 0 1px rgba(212,255,58,${0.4 * hover})`,
                `0 ${8 + hover * 22}px ${24 + hover * 40}px rgba(0,0,0,${0.25 + hover * 0.25})`,
                lime > 0 ? `0 0 ${30 * lime}px rgba(212,255,58,${0.22 * lime})` : '',
              ].filter(Boolean).join(', '),
              opacity: Math.min(1, appear * 1.4),
              transform: `translateY(${(1 - appear) * 36 - hover * 8}px) scale(${(0.88 + 0.12 * appear) * (1 + hover * 0.025)})`,
              transformOrigin: '50% 100%',
            }}>
              <div style={{ position: 'absolute', inset: 0, opacity: lime, background: `linear-gradient(180deg, ${C.accentSoft} 0%, ${C.accent} 38%, #A9D11C 100%)` }} />
              {content > 0 && (
                <TemplateCardContent index={i} data={TEMPLATES[i]} votes={votes} voted={voted} votePop={votePop} content={content} />
              )}
            </div>
            {isVoted && float > 0 && float < 1 && (
              <div style={{
                position: 'absolute', left: from.x + from.w - 16 - 52, top: from.y + GRID.coverH + 4 - float * 46,
                fontFamily: FONT.mono, fontSize: 20, fontWeight: 500, color: C.accent,
                opacity: interpolate(float, [0, 0.15, 0.7, 1], [0, 1, 1, 0]), textShadow: `0 0 16px ${C.accent}`,
                transform: `scale(${0.8 + float * 0.4})`,
              }}>+1</div>
            )}
          </div>
        );
      })}
    </div>
  );
};
